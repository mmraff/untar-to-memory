const fs = require('fs')
const path = require('path')

const rimraf = require('rimraf')
const tap = require('tap')

const readEntry = require('../index.js').readEntry
const fxs = require('./fixtures/fixtures.js')

let i = 0
let tarball
let entryList
let currTest

// LOTS of EBADF errors since fix for issue #4.
// Apparently you can over-challenge the filesystem's ability to keep up with
// file descriptors.
// Workaround: try n times, with a small delay for each, before giving up
function attemptToRead(filePath, countDown, done) {
  setTimeout(function() {
    fs.readFile(filePath, function (err, buf) {
      if (err && err.code == 'EBADF' && --countDown)
        return attemptToRead(filePath, countDown, done)
      done(err, buf)
    })
  }, 10)
}

function readNextItem () {
  // Workaround for directory entries in entryList
  while (entryList[i].slice(-1) == '/') {
    if (++i >= entryList.length) return currTest.end()
  }
  readEntry(tarball, entryList[i], {}, function (err, buf) {
    if (err) {
      currTest.fail(err.message)
      return currTest.end()
    }

    const entryPath = path.resolve(
      __dirname, 'fixtures/tarball_base', entryList[i]
    )

    attemptToRead(entryPath, 3, function(rfErr, rfBuf) {
      if (rfErr) {
        currTest.fail(rfErr.message)
        return currTest.end()
      }
      // "If no encoding is specified, then the raw buffer is returned."
      currTest.ok(buf.equals(rfBuf), entryList[i] + ' should match fs copy')
      i++
      if (i >= entryList.length) { return currTest.end() }
      readNextItem()
    })
  })
}

tap.test('Read gzipped tarball entry data to buffer and validate', t => {
  tarball = fxs.naturalTgz
  entryList = fxs.naturalEntries
  currTest = t

  // The Kick-off
  readNextItem()
})

tap.test('Read naked tarball entry data to buffer and validate', t => {
  i = 0
  tarball = fxs.constructedTar
  entryList = fxs.constructedEntries
  currTest = t

  readNextItem()
})

// NOTE: in the case of an absolute-path entry, it is or isn't listed by
// command-line tar when the pattern is "*/filename" depending on options:
// * wildcards (wildcardsMatchSlash): yes, all "filename" (if dir, then + all under it)
// * wildcards wildcardsMatchSlash=false: only matches entry "/filename"
// * wildcards (wildcardsMatchSlash) recursion=false: only whole matches
//   (e.g. "*/crontab" gets /etc/crontab, but "/etc" gets nothing on same
//   tarball if there's no entry "/etc/")
// * wildcards wildcardsMatchSlash=false recursion=false: only whole matches

function testPatternMatch (myTest, pattern, opts, re_file) {
  const tarball = fxs.constructedTar
  const entryList = fxs.constructedEntries
  
  readEntry(tarball, pattern, opts, function (tbErr, tbBuf) {
    if (tbErr) {
      myTest.fail(tbErr.message)
      return myTest.end()
    }

    let entryMatch
    for (const entry of entryList) {
      if (re_file.test(entry)) {
        entryMatch = entry
        break
      }
    }
    if (!entryMatch) {
      throw new Error(
        `No match for ${re_file} on entries of fixture ${tarball}!`
      )
    }
    const entryPath = path.resolve(__dirname, 'fixtures/tarball_base', entryMatch)

    attemptToRead(entryPath, 3, function(fsErr, fsBuf) {
      if (fsErr) { myTest.fail(fsErr.message) }
      else {
        myTest.ok(tbBuf.equals(fsBuf), [
          'Passing "', pattern, '" with opts ', JSON.stringify(opts),
          ' to readEntry() should yield same contents as ', entryMatch
        ].join(''))
      }
      myTest.end()
    })
  })
}

tap.test('Restricted wildcard fetch of tarball entry data', t => {
  const opts = { wildcards: true, wildcardsMatchSlash: false }
  const globExpr = '*/passwords.txt'
  const RE_NoGlobStar = /^[^\/]*\/passwords.txt/

  testPatternMatch(t, globExpr, opts, RE_NoGlobStar)
})

tap.test('Globstar wildcard fetch of tarball entry data', t => {
  const opts = { wildcards: true }
  const globExpr = '*/passwords.txt'
  const RE_GlobStar = /^.*\/passwords.txt/

  testPatternMatch(t, globExpr, opts, RE_GlobStar)
})

tap.test('"ignoreCase" allows a match regardless of pattern case', t => {
  const opts = { ignoreCase: true }
  const pattern = 'NPM-DEBUG.LOG'
  const RE_patt = /^NPM-DEBUG.LOG$/i

  testPatternMatch(t, pattern, opts, RE_patt)
})

tap.test('Unrecognized options trigger warnings but do not end the call', t => {
  const warningData = []
  const { log, info, warn } = console
  console.log = () => {}
  console.info = () => {}
  console.warn = (data, ...args) => {
    warningData.push({ data, args })
  }
  const opts = { debug: true, yada: 'maybe so', dada: 'maybe not' }
  readEntry(fxs.naturalTgz, 'passwords.txt', opts, (err, data) => {
    console.warn = warn
    console.info = info
    console.log = log
    t.match(warningData, [
      { data: /WARN/, args: [ 'Invalid option(s) given:' ] },
      { data: /WARN/, args: [ 'yada, dada' ] }
    ])
    t.equal(err, undefined)
    t.ok(data)
    t.end()
  })
})

tap.test('Invalid wildcard pattern given for filename', t => {
  readEntry(fxs.naturalTgz, '\n', { wildcards: true }, (err, data) => {
    t.match(err.message, /^Invalid match pattern /)
    t.equal(data, undefined)
    t.end()
  })
})

tap.test('When there is no match', t => {
  const tarball = fxs.constructedTar
  readEntry(tarball, 'z/', null, (err, buf) => {
    t.match(err, { message: /No match for z\//, code: 'ENOENT' })
    t.equal(buf, undefined)
    t.end()
  })
})

tap.test('Option: anchored, default true vs explicitly set', t => {
  // 'anchored' (as defined in the tar man page, though ambiguously) is the
  // default behavior, but we must get the same behavior when it's explicitly
  // set to true.
  // Expect readEntry to wait to match the root entry passwords.txt, instead of
  // accepting the entry 'a/b/c/passwords.txt' that comes first in the archive:
  const tarball = fxs.constructedTar
  const searchKey = 'urtyegIlCid6' // Only to be found in the root passwords.txt
  readEntry(tarball, 'passwords.txt', null, (err, buf) => {
    t.equal(err, undefined)
    t.ok(
      buf.toString().includes(searchKey),
      `Only the root passwords.txt contains the string "${searchKey}"`
    )
    const opts = { wildcards: true, anchored: true }
    readEntry(tarball, 'passwords.txt', opts, (err, buf) => {
      t.equal(err, undefined)
      t.ok(
        buf.toString().includes(searchKey),
        `Only the root passwords.txt contains the string "${searchKey}"`
      )
      t.end()
    })
  })
})

tap.test('Option anchored = false', t => {
  // Expect readEntry to accept the entry 'a/b/c/passwords.txt' which appears
  // earlier in the archive, instead of waiting to match the root passwords.txt:
  const tarball = fxs.constructedTar
  const searchKey = 'ToksEgByRif3' // Only to be found in a/b/c/passwords.txt
  const opts = { wildcards: true, anchored: false }
  readEntry(tarball, 'passwords.txt', opts, (err, buf) => {
    t.equal(err, undefined)
    t.ok(
      buf.toString().includes(searchKey),
      `Only a/b/c/passwords.txt contains the string "${searchKey}"`
    )
    t.end()
  })
})

tap.test('Not a gzipped tarball', t => {
  readEntry(fxs.gzNotTar, 'a', null, (err, data) => {
    t.match(err, {
      message: 'Invalid entry for a tar archive', code: 'EFTYPE'
    })
    t.equal(data, undefined)
    t.end()
  })
})

tap.test('Truncated tarball', t => {
  readEntry(fxs.brokenTgz, 'a/b/c', null, (err, data) => {
    t.match(err, {
      message: 'zlib: unexpected end of file', code: 'Z_BUF_ERROR'
    })
    t.equal(data, undefined)
    t.end()
  })
})

tap.test('invalid values for valid options', t => {
  const badOpts = [
    { name: 'debug', value: 1 },
    { name: 'ignoreCase', value: 'y' },
    { name: 'wildcards', value: 'y' },
    { name: 'wildcardsMatchSlash', value: 'ok' },
    { name: 'anchored', value: 'only' }
  ]
  const nextBadOpt = (i) => {
    if (i >= badOpts.length) return t.end()
    const opt = badOpts[i]
    readEntry(fxs.naturalTgz, 'passwords.txt', { [opt.name]: opt.value }, (er, data) => {
      t.match(er, {
        message: `Invalid value type given for option "${opt.name}"`,
        code: 'EINVAL'
      })
      t.equal(data, undefined)
      nextBadOpt(i + 1)
    })
  }
  nextBadOpt(0)
})

tap.tearDown(function() {
  const extractPath = path.resolve(__dirname, 'fixtures/tarball_base')
  rimraf(extractPath, function(err) {})
})

