const tap = require('tap')
const untar = require('../index.js')
const fs = require('fs')
const path = require('path')
const fxs = require('./fixtures/fixtures.js')

// Our list of entries in fixtures.js comes directly from tar -tzf output
// on the command line, so one might expect that list results will always
// match it (or a subset obtained from iterating it). Not necessarily so:
// if the tarball ever gets regenerated, it may have a different order than
// the old list in fixtures.js. So we do the following, and we will sort
// list results as we get them:
fxs.naturalEntries.sort()
// DO NOT do this to fxs.constructedEntries, though!

tap.test('No tarball path given', t => {
  t.rejects(untar.list(), SyntaxError)
  for (const arg of [ undefined, null, '' ])
    t.rejects(untar.list(arg, {}), SyntaxError)
  t.end()
})

tap.test('Wrong type given for tarball path', t => {
  const tgz = fxs.naturalTgz
  const badArgs = [ true, 42, { tarball: tgz }, [ tgz ], () => tgz ]
  for (const arg of badArgs)
    t.rejects(untar.list(arg, {}), TypeError)
  t.end()
})

tap.test('Nonexistent tarball', t => {
  t.rejects(
    untar.list(path.join(__dirname, 'fixtures/NOSUCH')),
    { message: /no such file or directory/, code: 'ENOENT' }
  )
  t.end()
})

// The following case also leads to coverage of the multiple error situation
// by triggering multiple calls to setResult() for a single call to list()
// (Why there have to be multiple errors from zlib in this case, I don't know)
tap.test('file faked to look like gzipped tarball', t => {
  t.rejects(
    untar.list(fxs.fakeTgz),
    { message: 'zlib: unknown compression method', code: 'Z_DATA_ERROR' }
  )
  t.end()
})

tap.test('list truncated gzipped tarball', t => {
  t.rejects(
    untar.list(fxs.brokenTgz),
    { message: 'zlib: unexpected end of file', code: 'Z_BUF_ERROR' }
  )
  t.end()
})

tap.test('file faked to look like bzipped tar file', t => {
  t.rejects(
    untar.list(fxs.fakeBz2, { bzip2: true }),
    { message: 'Initial position larger than buffer size', code: undefined }
  )
  t.end()
})

tap.test('list bzipped mangled tar file', t => {
  t.rejects(
    untar.list(fxs.brokenTbz2, { bzip2: true }),
    { message: 'Invalid entry for a tar archive', code: 'EFTYPE' }
  )
  t.end()
})

tap.test('list gzipped non-tarred file', t => {
  t.rejects(
    untar.list(fxs.gzNotTar),
    { message: 'Invalid entry for a tar archive', code: 'EFTYPE' }
  )
  t.end()
})

tap.test('list file that is not a tarball', t => {
  t.rejects(
    untar.list(fxs.notTarball),
    { message: /^Invalid entry for a tar archive/, code: 'EFTYPE' }
  )
  t.end()
})

tap.test('invalid values for valid options', t => {
  const badOpts = [
    { name: 'debug', value: 1 }, // boolean or keyword
    { name: 'ignoreCase', value: 'y' }, // boolean required
    { name: 'wildcards', value: 'y' }, // boolean required
    { name: 'wildcardsMatchSlash', value: 'ok' }, // boolean required
    { name: 'recursion', value: 'maybe' }, // boolean required
    { name: 'anchored', value: 'only' }, // boolean required
    { name: 'pattern', value: new Date() }, // string required
    { name: 'useCompressProgram', value: 42 }, // keyword required
    { name: 'I', value: true }, // keyword required
    { name: 'bzip2', value: 'sure' }, // boolean required
    { name: 'gzip', value: 'good' }, // boolean required
    { name: 'lzma', value: 'fine' }, // boolean required
    { name: 'xz', value: [] } // boolean required
  ]
  const nextBadOpt = (i) => {
    if (i >= badOpts.length) return t.end()
    const opt = badOpts[i]
    return t.rejects(untar.list(fxs.naturalTgz, { [opt.name]: opt.value }), {
      message: `Invalid value type given for option "${opt.name}"`,
      code: 'EINVAL'
    })
    .finally(() => nextBadOpt(i + 1))
  }
  nextBadOpt(0)
})

tap.test('invalid pattern given to list paths', t => {
  t.rejects(
    untar.list(fxs.naturalTgz, { pattern: '\n' }),
    { message: /Invalid match pattern / }
  )
  t.end()
})

tap.test('unsupported compression program option', t => {
  t.rejects(
    untar.list(fxs.naturalTgz, { useCompressProgram: 'zip' }),
    { message: 'Compression method unsupported: zip', code: 'EINVAL' }
  )
  t.rejects(
    untar.list(fxs.naturalTgz, { I: 'compress' }),
    { message: 'Compression method unsupported: compress', code: 'EINVAL' }
  )
  t.end()
})

tap.test('conflicting compression program options', t => {
  t.rejects(
    untar.list(fxs.naturalTgz, { useCompressProgram: 'gzip', I: 'xz' }),
    { message: 'Conflicting compression options', code: 'EINVAL' }
  )
  t.rejects(
    untar.list(fxs.naturalTgz, { useCompressProgram: 'gzip', bzip2: true }),
    { message: 'Conflicting compression options', code: 'EINVAL' }
  )
  t.rejects(
    untar.list(fxs.naturalTgz, { bzip2: true, lzma: true }),
    { message: 'Conflicting compression options', code: 'EINVAL' }
  )
  t.end()
})

tap.test('list gzipped tarball by auto-detection', t => {
  const tarball = fxs.naturalTgz
  const entryList = fxs.naturalEntries

  return untar.list(tarball).then(data => {
    t.same(
      data.sort(), entryList,
     'list() with no opts should yield same as fixtures entry list'
    )
  })
})

tap.test('list gzipped tarball specified by compression type', t => {
  const tarball = fxs.naturalTgz
  const entryList = fxs.naturalEntries

  return untar.list(tarball, { useCompressProgram: 'gzip' })
  .then(data => {
    t.same(
      data.sort(), entryList,
     'list() with useCompressProgram=gzip should yield same as fixtures entry list'
    )
  })
  .then(() => untar.list(tarball, { I: 'gzip' }))
  .then(data => {
    t.same(
      data.sort(), entryList,
     'list() with I=gzip should yield same as fixtures entry list'
    )
  })
  .then(() => untar.list(tarball, { gzip: true }))
  .then(data => {
    t.same(
      data.sort(), entryList,
     'list() with gzip=true should yield same as fixtures entry list'
    )
  })
})

tap.test('list bzip2-compressed tarball specified by compression type', t => {
  const tarball = fxs.naturalTbz2
  const entryList = fxs.naturalEntries

  return untar.list(tarball, { useCompressProgram: 'bzip2' })
  .then(data => {
    t.same(
      data.sort(), entryList,
     'list() with useCompressProgram=bzip2 should yield same as fixtures entry list'
    )
  })
  .then(() => untar.list(tarball, { I: 'bzip2' }))
  .then(data => {
    t.same(
      data.sort(), entryList,
     'list() with I=bzip2 should yield same as fixtures entry list'
    )
  })
  .then(() => untar.list(tarball, { bzip2: true }))
  .then(data => {
    t.same(
      data.sort(), entryList,
     'list() with bzip2=true should yield same as fixtures entry list'
    )
  })
})

tap.test('list lzma-compressed tarball specified by compression type', t => {
  const tarball = fxs.naturalTlzma
  const entryList = fxs.naturalEntries

  return untar.list(tarball, { useCompressProgram: 'lzma' })
  .then(data => {
    t.same(
      data.sort(), entryList,
     'list() with useCompressProgram=lzma should yield same as fixtures entry list'
    )
  })
  .then(() => untar.list(tarball, { I: 'lzma' }))
  .then(data => {
    t.same(
      data.sort(), entryList,
     'list() with I=lzma should yield same as fixtures entry list'
    )
  })
  .then(() => untar.list(tarball, { lzma: true }))
  .then(data => {
    t.same(
      data.sort(), entryList,
     'list() with lzma=true should yield same as fixtures entry list'
    )
  })
})

tap.test('list xz-compressed tarball specified by compression type', t => {
  const tarball = fxs.naturalTxz
  const entryList = fxs.naturalEntries

  return untar.list(tarball, { useCompressProgram: 'xz' })
  .then(data => {
    t.same(
      data.sort(), entryList,
     'list() with useCompressProgram=xz should yield same as fixtures entry list'
    )
  })
  .then(() => untar.list(tarball, { I: 'xz' }))
  .then(data => {
    t.same(
      data.sort(), entryList,
     'list() with I=xz should yield same as fixtures entry list'
    )
  })
  .then(() => untar.list(tarball, { xz: true }))
  .then(data => {
    t.same(
      data.sort(), entryList,
     'list() with xz=true should yield same as fixtures entry list'
    )
  })
})

tap.test('request bzip2 type for non-bzip2-compressed tarball', t => {
  t.rejects(
    untar.list(fxs.naturalTgz, { bzip2: true }),
    { message: 'No magic number found' }
  )
  t.end()
})

tap.test('request gzip type for a one-byte file', t => {
  t.rejects(
    untar.list(fxs.oneByte, { gzip: true }),
    { message: 'File is too short' }
  )
  t.end()
})

tap.test('request gzip type for non-gzip-compressed tarball', t => {
  t.rejects(
    untar.list(fxs.naturalTxz, { gzip: true }),
    { message: 'not in gzip format', code: 'EFTYPE' }
  )
  t.end()
})

tap.test('request lzma type for non-lzma-compressed tarball', t => {
  t.rejects(
    untar.list(fxs.naturalTgz, { lzma: true }),
    { message: 'File format not recognized', code: 'LZMA_FORMAT_ERROR' }
  )
  t.end()
})

tap.test('request xz type for non-xz-compressed tarball', t => {
  t.rejects(
    untar.list(fxs.naturalTgz, { xz: true }),
    { message: 'File format not recognized', code: 'LZMA_FORMAT_ERROR' }
  )
  t.end()
})

tap.test('list naked tarball', t => {
  const tarball = fxs.constructedTar
  const entryList = fxs.constructedEntries

  return untar.list(tarball).then(data => {
    t.same(
      data, entryList,
      'list() with no opts should yield same as fixtures entry list'
    )
  })
})

tap.test('enable logging at a specific level', t => {
  const messages = { info: 0, warn: 0 }
  const opts = { pattern: 'z', debug: 'warn', yada: 'to get warning' }
  const { info, warn } = console
  console.info = () => { messages.info++ }
  console.warn = () => { messages.warn++ }

  return untar.list(fxs.constructedTar, opts).then(data => {
    console.warn = warn
    console.info = info
    t.ok(messages.info === 0, 'Expect no info/verbose messages')
    t.ok(messages.warn > 0, 'Expect warning messages')
    t.same(data, []) // There's no entry to match 'z'
  })
})

tap.test('enable minimatch logging', t => {
  // minimatch only uses console.error for logging
  const consoleError = console.error
  let mmMsgCount = 0
  console.error = () => { ++mmMsgCount }
  return untar.list(fxs.constructedTar, { pattern: 'x', debug: 'minimatch' })
  .then(data => {
    console.error = consoleError
    t.ok(mmMsgCount > 0, 'Expect minimatch logging')
    t.equal(data.length, 2)
  })
})

function testUntarListVsRegex (t, tarball, opts, list, re) {
  return untar.list(tarball, opts).then(data => {
    const filteredList = []
    for (let i = 0; i < list.length; i++) {
      if (re.test(list[i])) { filteredList.push(list[i]) }
    }
    // I repeat, DO NOT sort the constructedEntries!!!
    if (tarball === fxs.naturalTgz) data.sort()
    t.same(data, filteredList, [
      'list() with opts ', JSON.stringify(opts),
      ' should yield same as fixtures entry list filtered by ', re.toString()
    ].join(''))
  })
}

tap.test('validate yield of list() with verbatim patterns', function (t) {
  let tarball = fxs.naturalTgz
  let entryList = fxs.naturalEntries
  let pattern = 'npm-debug.log' // A file entry

  // +"(?:\/.*)?$" ensures that the end of the verbatim pattern only matches
  // the end of a path component.
  return testUntarListVsRegex(
    t, tarball, {pattern: pattern}, entryList,
    new RegExp('^' + pattern + '(?:\/.*)?$')
  )
  .then(() => {
    pattern = 'a/b/c/d' // A non-empty directory entry
    return testUntarListVsRegex(
      t, tarball, {pattern: pattern}, entryList,
      new RegExp('^' + pattern + '(?:\/.*)?$')
    )
  })
  .then(() => {
    tarball = fxs.constructedTar
    entryList = fxs.constructedEntries
    pattern = 'a/b'
    return testUntarListVsRegex(
      t, tarball, {pattern: pattern}, entryList,
      new RegExp('^' + pattern + '(?:\/.*)?$')
    )
  })
})

tap.test('validate yield of list() with non-anchored pattern', t => {
  const tarball = fxs.naturalTgz
  const entryList = fxs.naturalEntries
  const opts = { pattern: 'passwords.txt', anchored: false }
  const re = new RegExp('^(?:.*\/)?' + opts.pattern + '$')

  return testUntarListVsRegex(t, tarball, opts, entryList, re)
})

tap.test('validate yield of list() with ignoreCase option', t => {
  const tarball = fxs.naturalTgz
  const entryList = fxs.naturalEntries
  const opts = { pattern: 'PaSsWoRdS.txt', anchored: false, ignoreCase: true }
  const re = new RegExp('^(?:.*\/)?' + opts.pattern + '$', 'i')

  return testUntarListVsRegex(t, tarball, opts, entryList, re)
})

// In the following...
// GS == Globstar; NoGS == NoGlobstar; NoR == NoRecursion
const wcOptions = {
  // Why is this here? It's not being used. Just for reader's reference?
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

// Admission: this following code is not very intuitively readable. However,
// it lends the advantage of collapsing what would otherwise be 60 tests into
// a nice compact block.
//
// Explanation:
// We have a 'natural' tarball, the one created in one shot by tar -czf;
// and we have a 'constructed' tarball, the one created by adding file entries
// one at a time so that the iteration order can be controlled.
// We have 6 patterns and 5 sets of filtering options, making for 30 tests.
// 1. Using the 'natural' tarball, we pass one of the patterns and one of the
//    set of filtering options, and compare the result of untar.list with what
//    we expect, which is encoded by a corresponding RegExp that we then apply
//    to the full list of actual entries.
// 2. Then we do the same using the 'constructed' tarball.
tap.test('Give list() a workout with option combinations', function (t) {
  let tarball = fxs.naturalTgz
  let entryList = fxs.naturalEntries
  const opts = { pattern: wcPatterns[0].untar, wildcards: true }

  function nextSequence(p) {
    if (p >= wcPatterns.length) {
      if (tarball === fxs.constructedTar) return Promise.resolve()
      tarball = fxs.constructedTar
      entryList = fxs.constructedEntries
      p = 0
    }
    opts.pattern = wcPatterns[p].untar

    return testUntarListVsRegex(
      t, tarball, opts, entryList, wcPatterns[p].reGS
    )
    .then(() => {
      opts.wildcardsMatchSlash = false
      return testUntarListVsRegex(
        t, tarball, opts, entryList, wcPatterns[p].reNoGS
      )
    })
    .then(() => {
      opts.recursion = false
      return testUntarListVsRegex(
        t, tarball, opts, entryList, wcPatterns[p].reNoGSNoR
      )
    })
    .then(() => {
      delete opts.wildcardsMatchSlash
      return testUntarListVsRegex(
        t, tarball, opts, entryList, wcPatterns[p].reGSNoR
      )
    })
    .then(() => {
      delete opts.recursion
      return nextSequence(p + 1)
    })
  }

  return nextSequence(0)
})

