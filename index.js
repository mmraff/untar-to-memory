exports.readEntry = readEntry
exports.list = listEntries

const tar = require("tar")
const fs = require("graceful-fs")
const zlib = require("zlib")
const minimatch = require("minimatch")
const assert = require("assert")
const makeLogFunc = require("./make-log-function.js")

const RE_STAR_CONTEXT = /(?:^|\/)\*(?:\/|$)/
const RE_RECURS_TAIL = /(?:^|\/)\**$/
const RE_STAR = /\*/

let debug = function () {}

const supportedOpts = { // with default values, for reference
  debug: false,
  ignoreCase: false,
  wildcards: false,
  wildcardsMatchSlash: true,
  recursion: true,
  anchored: true,
  pattern: null
}

function listEntries(tarball, opts, cb)
{
  assert(typeof tarball === "string" && tarball.length,
         "Must give path to tarball")
  assert(typeof cb === "function", "Must give callback")

  const params = getParams(opts)
  if (params.pattern) { params.origPattern = params.pattern }
  checkHeader(tarball, params, getList, cb)
}

function readEntry (tarball, filename, opts, cb)
{
  assert(typeof tarball === "string" && tarball.length,
         "Must give path to tarball")
  assert(typeof filename === "string" && filename.length,
         "Must give name of file to seek")
  assert(typeof cb === "function", "Must give callback")

  const params = getParams(opts)
  params.pattern = params.origPattern = filename
  checkHeader(tarball, params, getFileBuffer, cb)
}

function getParams (obj)
{
  const params = {}
  const invalidOpts = []

  if (obj) {
    for (var key in obj) {
      if (!(key in supportedOpts)) {
        invalidOpts.push(key)
        continue
      }
      if (typeof obj[key] !== "object") {
        params[key] = obj[key]
      }
      // This space reserved for nested option objects.
      // For now, no such in the API.
    }
    if (obj.wildcards && typeof obj.wildcardsMatchSlash == "undefined") {
      params.wildcardsMatchSlash = true
    }
    if (obj.debug) {
      if (typeof obj.debug == "boolean") {
        debug = makeLogFunc("verbose")
      }
      else if (typeof obj.debug == "string" &&
               obj.debug.toLowerCase() != "minimatch") {
        debug = makeLogFunc(obj.debug)
      }

      if (invalidOpts.length) {
        debug("warn", "Invalid options given:")
        debug("warn", invalidOpts.join(', '))
      }
      // Any other things to complain about here...
    }
  }
  return params
}

function checkHeader(tarball, params, next, cb0)
{
  function cb1 (er, data) {
    if (cbCalled) return;
    cbCalled = true
    cb0(er, data)
  }

  let cbCalled = false
  const fst = fs.createReadStream(tarball)

  fst.on("open", function (fd) {
    fs.fstat(fd, function (er, st) {
      if (er) return fst.emit("error", er)
      if (st.size === 0) {
        er = new Error("0-byte file " + tarball)
        fst.emit("error", er)
      }
    })
  })
  .on("error", function (er) {
    if (er) {
      if (er.code === "ENOENT") {
        er.message = "tar archive not found: "+tarball
      }
    }
    else { er = "Unknown error event while reading " + tarball }
    // But when would there ever be an error event without an error object?
    debug("warn", er.message)
    cb1(er)
  })
  .on("data", function OD (c) {
    params.tarballpath = tarball
    // gzipped tarball or a naked tarball? or not a tarball?
    // gzipped files all start with 1f8b08
    if (c[0] === 0x1F &&
        c[1] === 0x8B &&
        c[2] === 0x08) {
      debug("info", tarball + " is gzipped")
      next(fst.pipe(zlib.Unzip()), params, cb1)
    }
    else if (hasTarHeader(c)) {
      debug("info", tarball+" is a naked tar file")
      next(fst, params, cb1)
    }
    else {
      debug("warn", tarball+" is not a tarball")
      return cb1(new Error("Not a tarball: " + tarball))
    }

    // Finished check.
    // We're still on the 1st chunk, so we can restart:
    fst.removeListener("data", OD)
    fst.emit("data", c)
  });
}

function starsToGlobstars (source)
{
  var matches
    , idxAfter
    , parts = []
    , result
    ;
  while (matches = RE_STAR_CONTEXT.exec(source)) {
    if (0 < matches.index) {
      parts.push(source.substring(0, matches.index))
    }
    parts.push(matches[0].replace(RE_STAR, '**'))
    idxAfter = matches.index + matches[0].length
    source = source.substring(idxAfter)
  }
  if (source) { parts.push(source) }
  result = parts.join('')
  if (result.substring(0,3) === "**/") {
    // Correction for tar wildcard-match-slash behavior vs. globstar behavior
    result = "*/" + result
  }
  return result
}

function createMatcher (params, fst)
{
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
  if (params.debug == "minimatch") { options.debug = true }

  const mm = new minimatch.Minimatch(params.pattern, options)
  if (!mm.makeRe()) { // Bad pattern
    var err = new Error("Invalid match pattern " + params.origPattern)
    err.code = "EINVAL"
    fst.emit("error", err)
  }
  return mm
}

function getFileBuffer(fst, params, cb)
{
  let content = null
  let start = 0
  let err = null
  let mm

  debug("verbose", "Requested pattern: " + params.origPattern);
  if (params.wildcards) {
    if (params.wildcardsMatchSlash && RE_STAR_CONTEXT.test(params.pattern)) {
        params.pattern = starsToGlobstars(params.pattern)
        debug("verbose", "Modified pattern: " + params.pattern)
    }
    if (typeof params.anchored != "undefined") {
      debug("warn", "No support for 'anchored' option in this version of readEntry")
      delete params.anchored
    }

    mm = createMatcher(params, fst)
    if (!mm) return
  }

  function processEntry(entry) {
    entry.on("error", function(err) {
      debug("error", "Caught in processEntry 'error' event handler")
      cb(err)
      tarParser.end()
    })
    if (entry.ignore || entry.meta) return entry.resume()

    // It's meaningless to send back non-file data
    if (entry.type != 'File') return entry.resume()

    let isMatch
      ;
    debug("verbose", "Testing entry: " + entry.path)
    if (mm) { // Minimatch instance was obtained => wildcarded pattern
      isMatch = mm.match(entry.path)
    }
    else {
      isMatch = params.ignoreCase ?
        (entry.path.toLowerCase() == params.pattern.toLowerCase()) :
        (entry.path == params.pattern)
    }
    if (!isMatch) return entry.resume()

    tarParser.removeListener("entry", processEntry)
    debug("verbose", "Match found for pattern " + params.origPattern)

    // TODO: impose an upper limit on the size!
    content = new Buffer(entry.size)

    entry.on("data", function (data) {
      data.copy(content, start, 0, data.length)
      start += data.length
    })
    entry.on("end", function () {
      debug("verbose", "Reached end of data for matched entry")
      cb(null, content)
      tarParser.end()
    })
  }

  const tarParser = new tar.Parse()
  fst.pipe(tarParser)
    .on("entry", processEntry)
    .on("error", function (er) {
      err = er || new Error("unknown parse error")
      if (!err.path) { err.path = params.tarballpath }
      debug("error", err.message)
      this.emit("end")
    })
    .on("end", function() {
      debug("verbose", "Parse-stream received 'end' event")
      if (!content && !err) {
        err = new Error(
          params.origPattern+" not found in archive "+params.tarballpath)
        err.code = "ENOENT"
        err.path = params.origPattern
        debug("warn", err.message)
      }
      if (err) cb(err)
    })
}

function getList(fst, params, cb)
{
  const list = []
  const dirs = []
  const recursOpts = {}
  let dirIndex = -1
  let err = null
  let mm = null
  let i
  let handleEntryPath = function (entry) {
    if (!entry.ignore && !entry.meta) {
      debug("verbose", "default handleEntryPath: adding '" + entry.path + "' to list")
      list.push(entry.path)
    }
    entry.resume()
  }

  function filterEntryPath(entry)
  {
    let isMatched = false
    let tailMatches
    let globPattern

    if (entry.ignore || entry.meta) return entry.resume()
    debug("info", "filterEntryPath: testing '" + entry.path + "'")
    if (dirIndex != -1) {
      debug("verbose", "Betting on previous recursive match for next...")
      if (minimatch(entry.path, dirs[dirIndex], recursOpts)) {
        debug("verbose", "Matched by recursion from "+dirs[dirIndex])
        list.push(entry.path)
        return entry.resume()
      }
      debug("verbose", "unsuccessful.")
    }
    if (mm.match(entry.path)) {
      debug("verbose", "Non-recursive match.")
      list.push(entry.path)
      dirIndex = -1
      if (entry.type == "Directory" && params.recursion != false) {
        debug("verbose", "Entry is a directory: "+entry.path)
        dirIndex = dirs.length
        // Trust that a directory entry path always has '/' on the end
        dirs.push(entry.path + "**")
      }
    }
    else if (params.recursion != false) {
      // Check the matching dir paths seen so far, in case this entry is
      // descended from one and "serially orphaned" from its ancestor
      debug("verbose", "Trying previously successful recursion patterns for match...")
      for (i = 0; i < dirs.length; i++) {
        if (i == dirIndex) { // Already checked this dir prefix above
          dirIndex = -1
          continue
        }
        if (minimatch(entry.path, dirs[i], recursOpts)) {
          debug("verbose", "Matched by nonconsecutive recursion from "+dirs[i])
          isMatched = true
          list.push(entry.path)
          break
        }
      }
      if (!isMatched && params.anchored != false) { // Try one more thing...
        debug("verbose", "In case of tarball that lacks Directory entry:")
        debug("verbose",
          "Testing if pattern '"+params.pattern+"' qualifies for ad-hoc match...")
        tailMatches = RE_RECURS_TAIL.exec(params.pattern)
        if (!tailMatches) { globPattern = params.pattern + "/**" }
        else if (tailMatches[0] == "/") { globPattern = params.pattern + "**" }
        else if (tailMatches[0] == "/*" || tailMatches[0] == "*") {
          debug("verbose", "Original pattern untouched by starsToGlobstars")
          globPattern = params.pattern + '*'
        }
        // The only other possible matches here are '**' and '/**'
        // but if that pattern was used when we got no matches, then we're done
        else {
          debug("verbose", "No match for " + entry.path)
          return entry.resume()
        }
        debug("verbose", "Ad-hoc pattern: " + globPattern)
        if (minimatch(entry.path, globPattern, recursOpts)) {
          debug("verbose", "Matched: "+entry.path)
          list.push(entry.path)
          dirIndex = dirs.length
          dirs.push(globPattern)
        }
        else { debug("verbose", "No match for " + entry.path) }
      }
    }
    entry.resume()
  } // END function filterEntryPath

  if (params.pattern) {
    debug("info", "Pattern given; Minimatch instance will be used.")
    // implicitly covered case: --no-anchored (which requires a pattern)
    debug("verbose", "Requested pattern: " + params.origPattern)
    if (params.wildcards) {
      if (params.wildcardsMatchSlash && RE_STAR_CONTEXT.test(params.pattern)) {
        params.pattern = starsToGlobstars(params.pattern)
        debug("verbose", "Modified pattern: " + params.pattern)
      }
    }
    // Emits error from fst if regexp generation fails, causing abort:
    mm = createMatcher(params, fst)
    if (!mm) { return }
    if (params.recursion != false) {
      debug("info", "Recursion will be employed.")
      // These options are used by the general minimatch function employed for
      // recursion, *not* by the Minimatch instance created above
      for (var key in mm.options) { recursOpts[key] = mm.options[key] }
      if (recursOpts.noglobstar) { delete recursOpts.noglobstar }
    }
    handleEntryPath = filterEntryPath
  }
  else { debug("info", "No pattern given; all entries will be returned.") }

  const tarParser = new tar.Parse()
  fst.pipe(tarParser)
    .on("entry", handleEntryPath)
    .on("error", function (er) {
      err = er || new Error("unknown parse error")
      if (!err.path) { err.path = params.tarballpath }
      this.emit("end")
    })
    .on("end", function() {
      debug("verbose", "getList: got the 'end' event")
      return cb(err, list)
    });
}

function hasTarHeader (c)
{
  return c[257] === 0x75 && // tar archives have 7573746172 at position
         c[258] === 0x73 && // 257 and 003030 or 202000 at position 262
         c[259] === 0x74 &&
         c[260] === 0x61 &&
         c[261] === 0x72 &&

       ((c[262] === 0x00 &&
         c[263] === 0x30 &&
         c[264] === 0x30) ||

        (c[262] === 0x20 &&
         c[263] === 0x20 &&
         c[264] === 0x00))
}

