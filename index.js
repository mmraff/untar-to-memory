const buffer_kMaxLength = require('buffer').kMaxLength
const tar = require('tar')
const fs = require('fs')
const minimatch = require('minimatch')
const makeLogFunc = require('./make-log-function.js')

const addons = {}

const RE_STAR_CONTEXT = /(?:^|\/)\*(?:\/|$)/
const RE_RECURS_TAIL = /(?:^|\/)\**$/
const RE_STAR = /\*/
const RE_DIRPARENT = /^(.+\/)[^/]+\/$/

const validCompressPgms = [ 'bzip2', 'gzip', 'lzma', 'xz' ]
const supportedOpts = { // with default values, for reference
  debug: false,
  ignoreCase: false,
  wildcards: false,
  wildcardsMatchSlash: false,
  recursion: true,
  anchored: true,
  pattern: '',
  maxSize: 0,
  useCompressProgram: '', I: '',
  bzip2: false, gzip: false, lzma: false, xz: false
}
const getParams = obj => {
  const params = { log: () => {} }
  const invalidOpts = []
  const invalidVals = []

  if (obj) {
    let compressOptsCount = 0
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
      if (key === 'maxSize') {
        if (obj.maxSize < 0) {
          throw Object.assign(
            new Error('maxSize option cannot be negative'),
            { code: 'EINVAL' }
          )
        }
        if (obj.maxSize > buffer_kMaxLength)
          // Would log a warning here, but we don't have a logger at this point
          params.maxSize = 0
        else params.maxSize = obj.maxSize
      }
      else if (key === 'useCompressProgram' || key === 'I') {
        if (!params.useCompressProgram)
          params.useCompressProgram = obj[key]
        ++compressOptsCount
      }
      else if (validCompressPgms.includes(key)) {
        if (!params.useCompressProgram)
          params.useCompressProgram = key
        ++compressOptsCount
      }
      else params[key] = obj[key]
    }

    if (compressOptsCount > 1)
      throw Object.assign(
        new Error('Conflicting compression options'),
        { code: 'EINVAL' }
      )
    const compressPgm = params.useCompressProgram
    if (compressPgm && !validCompressPgms.includes(compressPgm))
      throw Object.assign(
        new Error('Compression method unsupported: ' + compressPgm),
        { code: 'EINVAL' }
      )

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

const starsToGlobstars = source => {
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

const createMatcher = params => {
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

class TarballReader {
  constructor () {
  }

  setResult (err, data) {
    const debug = this.params.log
    if (err) {
      // Ensure that any previous error is preserved
      if (!this.error) {
        this.error = err
      }
      else debug(
        'warn', 'Previous error will override this latest: ' + err
      )
    }
    else this.results = data
  }

  setUpStream () {
    const my = this
    const debug = this.params.log
    return new Promise((resolve, reject) => {
      const onCloseNoEnt = () => {
        debug('verbose', "readStream emitted premature 'close' event")
        const err = my.error
        delete my.error
        reject(err)
      }
      my.rstr = fs.createReadStream(my.tarballPath)
      .once('error', err => {
        debug('verbose', 'readStream emitted error event')
        // Ensure that any previous error is preserved
        /* istanbul ignore else - how to create multiple error case? */
        my.setResult(err)
      })
      //.once('end', () => { // Not needed
        //debug('verbose', 'readStream emitted end event')
      //})
      .once('close', onCloseNoEnt)
      .once('open', () => { // NOTE: the 'ready' event doesn't work here
        my.rstr.removeListener('close', onCloseNoEnt)
        debug('verbose', "readStream emitted 'open' event")
        resolve(true)
      })
    })
    .then(() => {
      my.resultP = new Promise((resolve, reject) => {
        my.rstr.once('close', () => {
          debug('verbose', "readStream emitted 'close' event")
          if (my.error) reject(my.error)
          else resolve(my.results)
        })
      })
    })
  }

  verifyGzipped() {
    const my = this
    const debug = this.params.log
    return new Promise((resolve, reject) => {
      my.rstr.once('readable', () => {
        const b = my.rstr.read(2)
        if (!b) return reject(Object.assign(
          new Error('File is too short'),
          { code: 'EFTYPE', path: my.tarballPath }
        ))
        my.rstr.pause()
        my.rstr.unshift(b)
        debug('verbose', 'readStream emitted readable event')
        // gzipped files all start with 0x1f 0x8b
        if (b[0] !== 0x1F || b[1] !== 0x8B)
          return reject(Object.assign(
            new Error('not in gzip format'),
            { code: 'EFTYPE', path: my.tarballPath }
          ))
        debug('verbose', my.tarballPath + ' has gzip magic')
        resolve(true)
      })
    })
  }

  getTarParseable() {
    const my = this
    const debug = this.params.log
    const pgm = this.params.useCompressProgram
    // If no compression type specified: node-tar can detect gzip...
    return !pgm ?
      Promise.resolve(this.rstr) :
      pgm === 'gzip' ? my.verifyGzipped().then(() => my.rstr) :
      new Promise((resolve, reject) => {
        let srcStr
        switch (pgm) {
          case 'bzip2':
            if (!addons.unbz2) {
              try {
                addons.unbz2 = require('unbzip2-stream')
              }
              catch (err) {
                /* istanbul ignore next: how could this be set up? */
                return reject(new Error(
                  'BZIP decoding not available without optional module installation'
                ))
              }
            }
            srcStr = my.rstr.pipe(addons.unbz2())
            break
          case 'lzma':
          case 'xz':
            if (!addons.lzma) {
              try {
                addons.lzma = require('lzma-native')
              }
              catch (err) {
                /* istanbul ignore next: how could this be set up? */
                return reject(new Error(
                  'LZMA/XZ decoding not available without optional module installation'
                ))
              }
            }
            srcStr = my.rstr.pipe(addons.lzma.Decompressor())
            break
        }
        srcStr.once('error', err => {
          // Detect lzma-native deviations
          if (err.name === 'LZMA_FORMAT_ERROR' &&
              err.desc && typeof err.code === 'number'
          ) {
            err = Object.assign(new Error(err.desc), { code: err.name })
          }
          my.setResult(err)
          my.closeReadStream()
        })
        resolve(srcStr)
      })
  }

  closeReadStream () {
    this.params.log('verbose', 'closeReadStream called.')
    this.rstr.destroy()
  }

  readEntry (tarball, filename, opts) {
    try {
      this.params = getParams(opts)
      this.params.pattern = this.params.origPattern = filename
      this.tarballPath = tarball
    }
    catch (err) { return Promise.reject(err) }

    return this.setUpStream()
    .then(() => this.getTarParseable())
    .then(srcStr => {
      const my = this
      const params = my.params
      const debug = params.log
      const maxSize = params.maxSize || 0
      let content = null
      let start = 0
      let mm

      // Since maxSize is not an actual option of tar (or minimatch),
      // we put it aside here.
      delete params.maxSize

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
          this.setResult(err)
          this.closeReadStream()
          return this.resultP
        }
      }

      const tarParser = my.dstr = new tar.Parse()
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

        if (maxSize && maxSize < entry.size) {
          tarParser.emit('error', Object.assign(
            new Error(`Limit of ${maxSize} bytes exceeded (${entry.size})`),
            { code: 'EFBIG', pattern: entry.path }
          ))
          return
        }

        tarParser.removeListener('entry', processEntry)
        debug('verbose', 'Match found for pattern ' + params.origPattern)

        // TODO: impose limit on entry size (see what is the limit of Buffer.allocUnsafe)
        content = Buffer.allocUnsafe(entry.size)
        entry.on('data', data => {
          data.copy(content, start, 0, data.length)
          start += data.length
        })
        entry.on('end', function () {
          tarParser.removeListener('entry', processEntry)
          if (srcStr.unpipe)
            // unbzip2-stream instances do not have unpipe (!?)
            srcStr.unpipe(tarParser)
          debug('verbose', 'Reached end of data for matched entry')
          //tarParser.end() // doesn't seem to do anything
          my.setResult(null, content)
          my.closeReadStream()
        })
      }

      tarParser.on('entry', processEntry)
      .on('warn', function TPW(msg, data) {
        debug('warn', 'readEntry: tarParser gave warning: ' + msg)
        if (msg === 'invalid entry') {
          tarParser.removeListener('warn', TPW)
          tarParser.emit('error', Object.assign(
            new Error('Invalid entry for a tar archive'),
            { code: 'EFTYPE', path: my.tarballPath }
          ))
        }
      })
      .once('error', err => {
        //tarParser.removeListener('entry', processEntry)
        tarParser.removeAllListeners('close')
        debug('warn', 'Tar parser emitted error event, error: ' + err)
        if (!err.path) { err.path = my.tarballPath }
        my.setResult(err)
        // In some cases this is unnecessary, but it doesn't hurt:
        my.closeReadStream()
        // tarParser.end() does nothing!!!
      })
      .once('close', function() {
        debug('verbose', 'Tar parser emitted "close" event')
        // The idea here is that if the target entry was found, we already removed
        // this listener, called setResult and closed the readStream, so we can
        // assume that if we get here, it means we had an error OR we did not find
        // the target entry.
        my.setResult(Object.assign(
          new Error(`No match for ${params.origPattern} in archive`),
          {
            code: 'ENOMATCH', pattern: params.origPattern,
            path: my.tarballPath
          }
        ))
      })

      srcStr.pipe(tarParser)
      return this.resultP
    })
  }

  getEntriesList (tarball, opts) {
    try {
      this.params = getParams(opts)
      if (this.params.pattern)
        this.params.origPattern = this.params.pattern
      this.tarballPath = tarball
    }
    catch (err) { return Promise.reject(err) }

    return this.setUpStream()
    .then(() => this.getTarParseable())
    .then(srcStr => {
      const my = this
      const params = my.params
      const debug = params.log
      const list = []
      const dirs = []
      const recursOpts = {}
      let dirIndex = -1
      let mm = null

      const handleEntryPath = entry => {
        /* istanbul ignore else */
        if (!entry.ignore && !entry.meta) {
          debug('verbose', [
            'Default handleEntryPath: adding "', entry.path, '" to list'
          ].join(''))
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
          // We want to avoid including directory paths that are matched when
          // minimatch accepts an empty substring for '**' on the end:
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
        // it could still be accepted below: pattern 'a/b' gets RE /^(?:a\/b)$/,
        // which will not match 'a/b/c'; but recursion will accept that unless
        // it is turned off explicitly.
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
            debug('verbose', [
              'Testing if pattern "', params.pattern,
              '" qualifies for ad-hoc match...'
            ].join(''))
            tailMatches = RE_RECURS_TAIL.exec(params.pattern)
            if (!tailMatches)
              globPattern = params.pattern + '/**'
            else if (tailMatches[0] == '/')
              globPattern = params.pattern + '**'
            else if (tailMatches[0] == '/*' || tailMatches[0] == '*') {
              debug('verbose', 'Original pattern untouched by starsToGlobstars')
              globPattern = params.pattern + '*'
            }
            // The only other possible matches here are '**' and '/**', but if
            // that pattern was used when we got no matches, then we're done
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
          this.setResult(err)
          this.closeReadStream()
          return this.resultP
        }

        if (params.recursion != false) {
          debug('info', 'Recursion will be employed.')
          // These options are used by the general minimatch function employed
          // for recursion, *not* by the Minimatch instance created above
          for (var key in mm.options) { recursOpts[key] = mm.options[key] }
          if (recursOpts.noglobstar) { delete recursOpts.noglobstar }
        }
        entryHandler = filterEntryPath
      }
      else { debug('info', 'No pattern given; all entries will be returned.') }

      const tarParser = new tar.Parse()
      tarParser.on('entry', entryHandler)
      .on('warn', function TPW(msg, data) {
        let err
        debug('warn', 'getList: tarParser gave warning: ' + msg)
        // For now, we've got the same error code for these two cases,
        // but we may want to change that later: if the zlib warning is not
        // addressed immediately, then an error with code Z_DATA_ERROR gets
        // thrown eventually, and there seems to be no way to catch it.
        if (msg === 'invalid entry')
          err = Object.assign(
            new Error('Invalid entry for a tar archive'),
            { code: 'EFTYPE', path: my.tarballPath }
          )
        else if (msg === 'zlib: unknown compression method') {
          tarParser.removeListener('warn', TPW)
          tarParser.end()
        }
        if (err) {
          tarParser.removeListener('warn', TPW)
          tarParser.end()
          tarParser.emit('error', err)
        }
      })
      .on('error', err => {
        tarParser.removeAllListeners('close')
        tarParser.removeListener('entry', entryHandler)
        if (srcStr.unpipe) {
          // unbzip2-stream instances do not have unpipe (!?)
          srcStr.unpipe(tarParser)
        }
        debug('warn', 'getList: tarParser got error event: ' + err.message)
        my.setResult(err)
        // MUST do this, because tarParser does not automatically close on error:
        my.closeReadStream()
      })
      .once('close', function() {
        debug('verbose', 'getList: got the "close" event')
        // Empty list is not an error.
        my.setResult(null, list)
      });

      srcStr.pipe(tarParser)
      return this.resultP
    })
  }
}

exports.list = (tarball, opts) => {
  if (tarball === undefined || tarball === null || tarball === '')
    return Promise.reject(new SyntaxError('Must give path to tarball'))
  if (typeof tarball !== 'string')
    return Promise.reject(new TypeError('Tarball path must be a string'))

  return new TarballReader().getEntriesList(tarball, opts)
}

exports.readEntry = (tarball, filename, opts) => {
  if (tarball === undefined || tarball === null || tarball === '')
    return Promise.reject(new SyntaxError('Must give path to tarball'))
  if (typeof tarball !== 'string')
    return Promise.reject(new TypeError('Tarball path must be a string'))
  if (filename === undefined || filename === null || filename === '')
    return Promise.reject(new SyntaxError('Must give path of file to seek'))
  if (typeof filename !== 'string')
    return Promise.reject(new TypeError('File path must be a string'))

  return new TarballReader().readEntry(tarball, filename, opts)
}

