exports.readEntry = readEntry
exports.list = listEntries

const tar = require('tar')
const fs = require('graceful-fs')
const zlib = require('zlib')
const minimatch = require('minimatch')
const assert = require('assert')
const makeLogFunc = require('./make-log-function.js')

const RE_STAR_CONTEXT = /(?:^|\/)\*(?:\/|$)/
const RE_RECURS_TAIL = /(?:^|\/)\**$/
const RE_STAR = /\*/
const RE_DIRPARENT = /^(.+\/)[^/]+\/$/

const gzipHead3ch = Buffer.from([0x1F, 0x8B, 0x08])

const supportedOpts = { // with default values, for reference
  debug: false,
  ignoreCase: false,
  wildcards: false,
  wildcardsMatchSlash: false,
  recursion: true,
  anchored: true,
  pattern: ''
}

function listEntries(tarball, opts, cb) {
  assert(typeof tarball === 'string' && tarball.length,
         'Must give path to tarball')
  assert(typeof cb === 'function', 'Must give callback')

  try {
    const params = getParams(opts)
    if (params.pattern) { params.origPattern = params.pattern }
    checkHeader(tarball, params, getList, cb)
  }
  catch (err) { cb(err) }
}

function readEntry (tarball, filename, opts, cb) {
  assert(typeof tarball === 'string' && tarball.length,
         'Must give path to tarball')
  assert(typeof filename === 'string' && filename.length,
         'Must give name of file to seek')
  assert(typeof cb === 'function', 'Must give callback')

  try {
    const params = getParams(opts)
    params.pattern = params.origPattern = filename
    checkHeader(tarball, params, getFileBuffer, cb)
  }
  catch (err) { cb(err) }
}

function getParams (obj) {
  const params = { log: () => {} }
  const invalidOpts = []
  const invalidVals = []

  if (obj) {
    for (const key in obj) {
      if (!(key in supportedOpts)) {
        invalidOpts.push(key)
        continue
      }
      if (typeof obj[key] !== typeof supportedOpts[key]) {
        if (key !== 'debug') {
          throw Object.assign(
            new Error(`Invalid value type given for option "${key}"`),
            { code: 'EINVAL' }
          )
        }
      }
      params[key] = obj[key]
    }
    if (obj.wildcards && typeof obj.wildcardsMatchSlash == 'undefined') {
      params.wildcardsMatchSlash = true
    }
    if (obj.debug) {
      if (typeof obj.debug == 'boolean') {
        params.log = makeLogFunc('verbose')
      }
      else if (typeof obj.debug == 'string') {
        if (obj.debug.toLowerCase() !== 'minimatch')
          params.log = makeLogFunc(obj.debug)
      }
      else {
        throw Object.assign(
          new Error('Invalid value type given for option "debug"'),
          { code: 'EINVAL' }
        )
      }

      if (invalidOpts.length && params.log) {
        params.log('warn', 'Invalid option(s) given:')
        params.log('warn', invalidOpts.join(', '))
      }
      // Any other things to complain about here...
    }
  }
  return params
}

const closeReadStream = rstr => {
  // fs.close(fileDescriptor) is nothing but a wild goose chase in this context.
  // Even when there's no error, it does not trigger a 'close' or 'end' event,
  // which we really need in order to know when to call the callback.
  // For compatibility with node engine v < 6, must resign to this way:
  rstr.resume()
  // Feature only available in node.js >= 8.0.0, requires major version bump:
  //rstr.destroy()
}

function checkHeader(tarball, params, next, cb0) {
  const debug = params.log
  let error
  let nextResult
  const rstr = fs.createReadStream(tarball)
  const setResult = (err, data) => {
    if (err) {
      // Ensure that any previous error is preserved
      /* istanbul ignore else - difficult to create multiple error case */
      if (!error) error = err
    }
    else nextResult = data
  }

  rstr.once('data', function OD (c) {
    params.tarballpath = tarball
    rstr.unshift(c)
    // gzipped files all start with 1f8b08
    if (c.slice(0, 3).compare(gzipHead3ch) === 0) {
      debug('info', tarball + ' is gzipped')
      // However, we don't know what is the format inside yet.
      // Might not be tar.
      next(rstr/*.pipe(zlib.Unzip())*/, params, setResult)
    }
    // Room here for other archive format detectors
    else {
      debug('info', `Assuming ${tarball} is a naked tar file`)
      next(rstr, params, setResult)
    }
  })
  .once('error', err => {
    debug('warn', 'readStream emitted error event')
    // Ensure that any previous error is preserved
    /* istanbul ignore else - difficult to create multiple error case */
    if (!error) error = err
    else debug(
      'warn', 'To be overridden by a previous one, latest error:', err.message
    )
  })
  .once('end', () => {
    debug('verbose', 'readStream emitted end event')
  })
  .once('close', () => {
    debug('verbose', 'readStream emitted close event')
    cb0(error, nextResult)
  })
}

function starsToGlobstars (source) {
  const parts = []
  let matches

  while (matches = RE_STAR_CONTEXT.exec(source)) {
    if (0 < matches.index) {
      parts.push(source.substring(0, matches.index))
    }
    parts.push(matches[0].replace(RE_STAR, '**'))
    const idxAfter = matches.index + matches[0].length
    source = source.substring(idxAfter)
  }
  if (source) { parts.push(source) }
  let result = parts.join('')
  if (result.substring(0,3) === '**/') {
    // Correction for tar wildcard-match-slash behavior vs. globstar behavior
    result = '*/' + result
  }
  return result
}

function createMatcher (params) {
  // We want behavior as close as possible to command-line tar:
  const options = {
    dot: true,
    nobrace: true,
    noext: true,
    noglobstar: true,
    nocomment: true,
    nonegate: true
  }

  if (params.ignoreCase) { options.nocase = true }
  if (params.wildcards && params.wildcardsMatchSlash) {
    delete options.noglobstar
  }
  if (params.anchored == false) { options.matchBase = true }
  if (params.debug == 'minimatch') { options.debug = true }

  const mm = new minimatch.Minimatch(params.pattern, options)
  if (!mm.makeRe()) { // Bad pattern
    throw Object.assign(
      new Error(`Invalid match pattern "${params.origPattern}"`),
      { code: 'EINVAL', pattern: params.origPattern }
    )
  }
  return mm
}

function getFileBuffer(rstr, params, setResult) {
  const debug = params.log
  let error = null
  let content = null
  let start = 0
  let mm

  debug('verbose', 'Requested pattern: ' + params.origPattern);
  if (params.wildcards) {
    if (params.wildcardsMatchSlash && RE_STAR_CONTEXT.test(params.pattern)) {
        params.pattern = starsToGlobstars(params.pattern)
        debug('verbose', 'Modified pattern: ' + params.pattern)
    }
    /*
    if (typeof params.anchored != 'undefined') {
      debug('warn', 'No support for "anchored" option in this version of readEntry')
      delete params.anchored
    }*/

    try { mm = createMatcher(params) }
    catch (err) {
      return setResult(err)
      //return closeReadStream(rstr)
    }
  }

  const tarParser = new tar.Parse()
  const processEntry = entry => {
    /* istanbul ignore if */
    if (entry.ignore || entry.meta) return entry.resume()

    // It's meaningless to send back non-file data
    if (entry.type != 'File') return entry.resume()

    let isMatch

    debug('verbose', 'Testing entry: ' + entry.path)
    if (mm) { // Minimatch instance was obtained --> wildcarded pattern
      isMatch = mm.match(entry.path)
    }
    else {
      isMatch = params.ignoreCase ?
        (entry.path.toLowerCase() == params.pattern.toLowerCase()) :
        (entry.path == params.pattern)
    }
    if (!isMatch) return entry.resume()

    tarParser.removeListener('entry', processEntry)
    debug('verbose', 'Match found for pattern ' + params.origPattern)

    content = Buffer.allocUnsafe(entry.size)
    entry.on('data', data => {
      data.copy(content, start, 0, data.length)
      start += data.length
    })
    //.on('error', err => {
    //  debug('warn', 'entry error: ' + err)
    //})
    // TODO: is there such a thing as an entry error?
    entry.on('end', function () {
      tarParser.removeListener('entry', processEntry)
      rstr.unpipe(tarParser)
      debug('verbose', 'Reached end of data for matched entry')
      //tarParser.end() // doesn't seem to do anything
      setResult(null, content)
      closeReadStream(rstr)
    })
  }

  tarParser.on('entry', processEntry)
  .on('warn', function TPW(msg, data) {
    debug('warn', 'getFileBuffer: tarParser gave warning: ' + msg)
    if (msg === 'invalid entry') {
      tarParser.removeListener('warn', TPW)
      tarParser.emit('error', Object.assign(
        new Error('Invalid entry for a tar archive'),
        { code: 'EFTYPE', path: params.tarballpath }
      ))
    }
  })
  .once('error', err => {
    //tarParser.removeListener('entry', processEntry)
    tarParser.removeAllListeners('close')
    debug('warn', 'Tar parser emitted error event, error: ' + err)
    if (!err.path) { err.path = params.tarballpath }
    error = err
    setResult(err)
    // In some cases this is unnecessary, but it doesn't hurt:
    closeReadStream(rstr, debug)
    // tarParser.end() does nothing!!!
  })
  .once('close', function() {
    debug('verbose', 'Tar parser emitted "close" event')
    // The idea here is that if the target entry was found, we already removed
    // this listener, called setResult and closed the readStream, so we can
    // assume that if we get here, it means we had an error OR we did not find
    // the target entry.
    error = Object.assign(
      new Error(`No match for ${params.origPattern} in archive`),
      {
        code: 'ENOENT', pattern: params.origPattern,
        path: params.tarballpath
      }
    )
    setResult(error)
  })

  rstr.pipe(tarParser)
}

function getList(rstr, params, setResult)
{
  const debug = params.log
  const list = []
  const dirs = []
  const recursOpts = {}
  let dirIndex = -1
  let mm = null
  let error

  const handleEntryPath = entry => {
    /* istanbul ignore else */
    if (!entry.ignore && !entry.meta) {
      debug('verbose', `default handleEntryPath: adding "${entry.path}" to list`)
      list.push(entry.path)
    }
    entry.resume()
  }
  let entryHandler = handleEntryPath

  const filterEntryPath = entry => {
    let isMatched = false
    let tailMatches
    let globPattern

    /* istanbul ignore if */
    if (entry.ignore || entry.meta) return entry.resume()
    debug('info', `filterEntryPath: testing "${entry.path}"`)
    if (dirIndex != -1) {
      debug('verbose', 'Betting on previous recursive match for next...')
      if (minimatch(entry.path, dirs[dirIndex], recursOpts)) {
        debug('verbose', 'Matched by recursion from ' + dirs[dirIndex])
        list.push(entry.path)
        return entry.resume()
      }
      debug('verbose', 'unsuccessful.')
    }
    if (mm.match(entry.path)) {
      debug('verbose', 'Non-recursive match (tentative).')
      // We want to avoid including directory paths that only match because
      // minimatch accepts an empty substring for '**':
      if (mm.pattern.endsWith('/**') && entry.path.endsWith('/')) {
        const matches = RE_DIRPARENT.exec(entry.path)
        if (matches && mm.match(matches[1]))
          list.push(entry.path)
        else debug('verbose', 'DISCARDED non-recursive match.')
      }
      else {
        list.push(entry.path)
        dirIndex = -1
        if (entry.type == 'Directory' && params.recursion != false) {
          debug('verbose', 'Entry is a directory: ' + entry.path)
          dirIndex = dirs.length
          // Trust that a directory entry path always has '/' on the end
          dirs.push(entry.path + '**')
        }
      }
    }
    // An example case in which the entry does not match the pattern, though
    // it could still be accepted below: pattern 'a/b' results in RE /^(?:a\/b)$/,
    // which will not match 'a/b/c'; but recursion will accept that unless it is
    // turned off explicitly.
    else if (params.recursion != false) {
      // Check the matching dir paths seen so far, in case this entry is
      // descended from one and "serially orphaned" from its ancestor
      dirs.length && debug('verbose',
        'Trying previously successful recursion patterns for match...')
      for (let i = 0; i < dirs.length; ++i) {
        if (i === dirIndex) { // Already checked this dir prefix above
          dirIndex = -1
          continue
        }
        if (minimatch(entry.path, dirs[i], recursOpts)) {
          debug('verbose', 'Matched by nonconsecutive recursion from ' + dirs[i])
          isMatched = true
          list.push(entry.path)
          break
        }
      }
      if (!isMatched && params.anchored != false) { // Try one more thing...
        debug('verbose', 'In case of tarball that lacks Directory entry:')
        debug('verbose',
          `Testing if pattern '${params.pattern}' qualifies for ad-hoc match...`)
        tailMatches = RE_RECURS_TAIL.exec(params.pattern)
        if (!tailMatches) { globPattern = params.pattern + '/**' }
        else if (tailMatches[0] == '/') { globPattern = params.pattern + '**' }
        else if (tailMatches[0] == '/*' || tailMatches[0] == '*') {
          debug('verbose', 'Original pattern untouched by starsToGlobstars')
          globPattern = params.pattern + '*'
        }
        // The only other possible matches here are '**' and '/**'
        // but if that pattern was used when we got no matches, then we're done
        else {
          debug('verbose', 'No match for ' + entry.path)
          return entry.resume()
        }
        debug('verbose', 'Ad-hoc pattern: ' + globPattern)
        if (minimatch(entry.path, globPattern, recursOpts)) {
          debug('verbose', '2 Matched tentatively: ' + entry.path)
          /*
          // Having great difficulty coming up with a case that takes us to
          // acceptance of the entry here; but not ready to let go of this case
          // treatment. The trouble is that I don't remember what drove me to
          // write this years ago, because I don't have a journal entry for it.
          if (entry.path.endsWith('/')) {
            const matches = RE_DIRPARENT.exec(entry.path)
            if (matches && minimatch(matches[1], globPattern, recursOpts))
              list.push(entry.path)
            else console.log('verbose', 'DISCARDED ad-hoc match.')
          }
          else {
          */
          if (!entry.path.endsWith('/')) {
            list.push(entry.path)
            dirIndex = dirs.length
            dirs.push(globPattern)
          }
          else debug('verbose', 'DISCARDED ad-hoc match.')
        }
        else { debug('verbose', 'No match for ' + entry.path) }
      }
    }
    entry.resume()
  } // END filterEntryPath

  if (params.pattern) {
    debug('info', 'Pattern given; Minimatch instance will be used.')
    // implicitly covered case: --no-anchored (which requires a pattern)
    debug('verbose', 'Requested pattern: ' + params.origPattern)
    if (params.wildcards) {
      if (params.wildcardsMatchSlash && RE_STAR_CONTEXT.test(params.pattern)) {
        params.pattern = starsToGlobstars(params.pattern)
        debug('verbose', 'Modified pattern: ' + params.pattern)
      }
    }
    try { mm = createMatcher(params) }
    catch (err) {
      return setResult(err)
    }

    if (params.recursion != false) {
      debug('info', 'Recursion will be employed.')
      // These options are used by the general minimatch function employed for
      // recursion, *not* by the Minimatch instance created above
      for (var key in mm.options) { recursOpts[key] = mm.options[key] }
      if (recursOpts.noglobstar) { delete recursOpts.noglobstar }
    }
    entryHandler = filterEntryPath
  }
  else { debug('info', 'No pattern given; all entries will be returned.') }

  const tarParser = new tar.Parse()
  tarParser.on('entry', entryHandler)
  .on('warn', function TPW(msg, data) {
    debug('warn', 'getList: tarParser gave warning: ' + msg)
    if (msg === 'invalid entry') {
      tarParser.removeListener('warn', TPW)
      tarParser.emit('error', Object.assign(
        new Error('Invalid entry for a tar archive'),
        { code: 'EFTYPE', path: params.tarballpath }
      ))
    }
  })
  .once('error', err => {
    tarParser.removeAllListeners('close')
    tarParser.removeListener('entry', entryHandler)
    rstr.unpipe(tarParser)
    debug('warn', 'getList: tarParser got error event: ' + err.message)
    setResult(err)
    // MUST do this, because tarParser does not automatically close on error:
    closeReadStream(rstr)
  })
  .once('close', function() {
    debug('verbose', 'getList: got the "close" event')
    // Empty list is not an error.
    setResult(null, list)
  });

  rstr.pipe(tarParser)
}

