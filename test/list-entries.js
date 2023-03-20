const tap = require('tap')
const untar = require('../index.js')
const fs = require('fs')
const path = require('path')
const fxs = require('./fixtures/fixtures.js')

tap.test('Nonexistent tarball', t => {
  untar.list(path.join(__dirname, 'test/fixtures/NOSUCH'), null, (er, data) => {
    t.match(er, { message: /no such file or directory/, code: 'ENOENT' })
    t.end()
  })
})

tap.test('list truncated tarball', t => {
  untar.list(fxs.brokenTgz, null, (er, data) => {
    t.match(er, {
      message: 'zlib: unexpected end of file', code: 'Z_BUF_ERROR'
    })
    t.equal(data, undefined)
    t.end()
  })
})

tap.test('list gzipped non-tarred file', t => {
  untar.list(fxs.gzNotTar, null, (er, data) => {
    t.match(er, {
      message: 'Invalid entry for a tar archive', code: 'EFTYPE'
    })
    t.equal(data, undefined)
    t.end()

  })
})

tap.test('list file that is not a tarball', t => {
  untar.list(fxs.notTarball, null, (er, data) => {
    t.match(er, {
      message: /^Invalid entry for a tar archive/, code: 'EFTYPE'
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
    { name: 'recursion', value: 'maybe' },
    { name: 'anchored', value: 'only' },
    { name: 'pattern', value: new Date() }
  ]
  const nextBadOpt = (i) => {
    if (i >= badOpts.length) return t.end()
    const opt = badOpts[i]
    untar.list(fxs.naturalTgz, { [opt.name]: opt.value }, (er, data) => {
      //console.log('invalid values for opts case:', er)
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

tap.test('try an invalid pattern to list paths', t => {

  untar.list(fxs.naturalTgz, { pattern: '\n' }, (er, data) => {
    t.match(er, /Invalid match pattern /)
    t.equal(data, undefined)
    t.end()
  })
})

tap.test('list gzipped tarball', function (t) {
  const tarball = fxs.naturalTgz
  const entryList = fxs.naturalEntries

  untar.list(tarball, null, function(er, data) {
    if (er) { t.fail(er.message) }
    else {
      t.same(data, entryList,
        'list() with no opts should yield same as fixtures entry list')
    }
    t.end()
  })
})

tap.test('list naked tarball', function (t) {
  const tarball = fxs.constructedTar
  const entryList = fxs.constructedEntries

  untar.list(tarball, null, function(er, data) {
    if (er) { t.fail(er.message) }
    else {
      t.same(data, entryList,
        'list() with no opts should yield same as fixtures entry list')
    }
    t.end()
  })
})

tap.test('enable logging at a specific level', t => {
  const messages = { info: 0, warn: 0 }
  const opts = { pattern: 'z', debug: 'warn', yada: 'to get warning' }
  const { info, warn } = console
  console.info = () => { messages.info++ }
  console.warn = () => { messages.warn++ }

  untar.list(fxs.constructedTar, opts, (er, data) => {
    console.warn = warn
    console.info = info
    t.ok(messages.info === 0, 'Expect no info/verbose messages')
    t.ok(messages.warn > 0, 'Expect warning messages')
    t.equal(er, undefined)
    t.same(data, [])
    t.end()
  })
})

tap.test('enable minimatch logging', t => {
  // minimatch only uses console.error for logging
  const consoleError = console.error
  let mmMsgCount = 0
  console.error = () => { ++mmMsgCount }
  untar.list(fxs.constructedTar, { pattern: 'x', debug: 'minimatch' }, (er, data) => {
    console.error = consoleError
    t.ok(mmMsgCount > 0, 'Expect minimatch logging')
    t.equal(er, undefined)
    t.equal(data.length, 2)
    t.end()
  })
})

function testUntarListVsRegex (t, tarball, opts, list, re, next) {
  untar.list(tarball, opts, function(er, data) {
    if (er) {
      t.fail(er.message)
    }
    else {
      const filteredList = []
      for (let i = 0; i < list.length; i++) {
        if (re.test(list[i])) { filteredList.push(list[i]) }
      }
      t.same(data, filteredList, [
        'list() with opts ', JSON.stringify(opts),
        ' should yield same as fixtures entry list filtered by ', re.toString()
      ].join(''))
    }
    next()
  })
}

tap.test('validate yield of list() with verbatim patterns', function (t) {
  let tarball = fxs.naturalTgz
  let entryList = fxs.naturalEntries
  let pattern = 'npm-debug.log' // A file entry

  // +"(?:\/.*)?$" ensures that the end of the verbatim pattern only matches
  // the end of a path component.
  testUntarListVsRegex(
    t, tarball, {pattern: pattern}, entryList,
    new RegExp('^' + pattern + '(?:\/.*)?$'), next1
  )

  function next1() {
    pattern = 'a/b/c/d' // A non-empty directory entry
    testUntarListVsRegex(
      t, tarball, {pattern: pattern}, entryList,
      new RegExp('^' + pattern + '(?:\/.*)?$'), () => { next2() }
    )
  }
  function next2() {
    tarball = fxs.constructedTar
    entryList = fxs.constructedEntries
    pattern = 'a/b'
    testUntarListVsRegex(
      t, tarball, {pattern: pattern}, entryList,
      new RegExp('^' + pattern + '(?:\/.*)?$'), () => { t.end() }
    )
  }
})

tap.test('validate yield of list() with non-anchored pattern', t => {
  const tarball = fxs.naturalTgz
  const entryList = fxs.naturalEntries
  const opts = { pattern: 'passwords.txt', anchored: false }
  const re = new RegExp('^(?:.*\/)?' + opts.pattern + '$')

  testUntarListVsRegex(t, tarball, opts, entryList, re, () => { t.end() })
})

tap.test('validate yield of list() with ignoreCase option', t => {
  const tarball = fxs.naturalTgz
  const entryList = fxs.naturalEntries
  const opts = { pattern: 'PaSsWoRdS.txt', anchored: false, ignoreCase: true }
  const re = new RegExp('^(?:.*\/)?' + opts.pattern + '$', 'i')

  testUntarListVsRegex(t, tarball, opts, entryList, re, () => { t.end() })
})

// In the following...
// GS == Globstar; NoGS == NoGlobstar; NoR == NoRecursion
const wcOptions = {
    reGS: { wildcards: true }
  , reNoGS: { wildcards: true, wildcardsMatchSlash: false }
  , reGSNoR: { wildcards: true, recursion: false }
  , reNoGSNoR: { wildcards: true, wildcardsMatchSlash: false, recursion: false }
}
const wcPatterns = [
    { untar: '*/*.txt'
    , reGS: /^.*\/[^\/]*\.txt\/?$/
    , reNoGS: /^[^\/]*\/[^\/]*\.txt\/?$/
    , reGSNoR: /^.*\/[^\/]*\.txt$/
    , reNoGSNoR: /^[^\/]*\/[^\/]*\.txt$/
    }
  , { untar: '*/rand-*'
    , reGS: /^.*\/rand-.*/
    , reNoGS: /^[^\/]*\/rand-.*/
    , reGSNoR: /^.*\/rand-[^\/]*\/?$/
    , reNoGSNoR: /^[^\/]*\/rand-[^\/]*\/?$/
    }
  , { untar: '*/c'
    , reGS: /^.*\/c(?:\/.*)?$/
    , reNoGS: /^[^\/]*\/c(?:\/.*)?$/
    , reGSNoR: /^.*\/c\/?$/
    , reNoGSNoR: /^[^\/]*\/c\/?$/
    }
  , { untar: '/*'
    , reGS: /^\/.*$/
    , reNoGS: /^\/.*$/
    , reGSNoR: /^\/.*$/
    , reNoGSNoR: /^\/[^\/]*$/
    }
  , { untar: 'a/b/c/'
    , reGS: /^a\/b\/c\/.*$/ // because recursion is default
    , reNoGS: /^a\/b\/c\/.*$/ // ditto
    , reGSNoR: /^a\/b\/c\/$/
    , reNoGSNoR: /^a\/b\/c\/$/
    }
  , { untar: 'a/b/*'
    , reGS: /^a\/b\/.+$/
    , reNoGS: /^a\/b\/.+$/ // because recursion is default
    , reGSNoR: /^a\/b\/.+$/ // globstar as last component effectively gets recursion
    , reNoGSNoR: /^a\/b\/[^\/]+\/?$/
    }
/* TEMPLATE
  , { untar: 
    , reGS: 
    , reNoGS: 
    , reGSNoR: 
    , reNoGSNoR: 
    }
*/
]

tap.test('Give list() a workout with option combinations', function (t) {
  let tarball = fxs.naturalTgz
  let entryList = fxs.naturalEntries
  const opts = { pattern: wcPatterns[0].untar, wildcards: true }
  let p = 0

  testUntarListVsRegex(
    t, tarball, opts, entryList, wcPatterns[p].reGS, do_reNoGS
  )

  function do_reNoGS () {
    opts.wildcardsMatchSlash = false
    testUntarListVsRegex(
      t, tarball, opts, entryList, wcPatterns[p].reNoGS, do_reNoGSNoR
    )
  }

  function do_reNoGSNoR () {
    opts.recursion = false
    testUntarListVsRegex(
      t, tarball, opts, entryList, wcPatterns[p].reNoGSNoR, do_reGSNoR
    )
  }

  function do_reGSNoR () {
    delete opts.wildcardsMatchSlash
    testUntarListVsRegex(
      t, tarball, opts, entryList, wcPatterns[p].reGSNoR, next
    )
  }

  function next () {
    p++
    if (p >= wcPatterns.length) {
      if (tarball === fxs.constructedTar) { return t.end() }
      tarball = fxs.constructedTar
      entryList = fxs.constructedEntries
      p = 0
    }

    delete opts.recursion
    opts.pattern = wcPatterns[p].untar
    testUntarListVsRegex(
      t, tarball, opts, entryList, wcPatterns[p].reGS, do_reNoGS
    )
  }
})

