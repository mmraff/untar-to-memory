const buffer_kMaxLength = require('buffer').kMaxLength
const readFile = require('fs').promises.readFile
const path = require('path')
const util = require('util')

const mkdirp = require("mkdirp")
const rimrafAsync = util.promisify(require('rimraf'))
const tap = require('tap')
const tar = require("tar")

const readEntry = require('../index.js').readEntry
const fxs = require('./fixtures/fixtures.js')

const extractPath = path.resolve(__dirname, 'fixtures/tarball_base')

tap.before(t => {
  return rimrafAsync(extractPath)
  .then(() => mkdirp(extractPath))
  .then(() => tar.x({ file: fxs.naturalTgz, C: extractPath }))
})

tap.teardown(function() {
  return rimrafAsync(extractPath)
})

const tgz = fxs.naturalTgz
const badArgs = [ true, 42, { tarball: tgz }, [ tgz ], () => tgz ]

tap.test('No tarball path given', t => {
  t.rejects(readEntry(), SyntaxError)
  for (const arg of [ undefined, null, '' ])
    t.rejects(readEntry(arg, 'passwords.txt'), SyntaxError)
  t.end()
})

tap.test('Wrong type given for tarball path', t => {
  for (const arg of badArgs)
    t.rejects(readEntry(arg, 'passwords.txt'), TypeError)
  t.end()
})

tap.test('No entry name given', t => {
  t.rejects(readEntry(fxs.naturalTgz), SyntaxError)
  for (const arg of [ undefined, null, '' ])
    t.rejects(readEntry(fxs.naturalTgz, arg), SyntaxError)
  t.end()
})

tap.test('Wrong type given for entry name', t => {
  for (const arg of badArgs)
    t.rejects(readEntry(fxs.naturalTgz, arg), TypeError)
  t.end()
})

tap.test('Wrong value type given for maxSize', t => {
  t.rejects(readEntry(fxs.naturalTgz, 'whatever', { maxSize: 'any' }), {
    message: 'Invalid value type given for option "maxSize"',
    code: 'EINVAL'
  })
  t.end()
})

tap.test('Negative number given for maxSize', t => {
  t.rejects(
    readEntry(fxs.naturalTgz, 'whatever', { maxSize: -1 }),//, debug: true }),
    { message: /^maxSize option cannot be negative/, code: 'EINVAL' }
  )
  t.end()
})

tap.test('Given maxSize greater than supported by node engine', t => {
  const entry = 'x/y/rand-bytes.bin'
  return readEntry(
    fxs.naturalTgz, entry, { maxSize: buffer_kMaxLength + 1 }
  )
  .then(buf1 => {
    const entryPath = path.resolve(extractPath, entry)
    return readFile(entryPath).then(buf2 => {
      t.ok(buf1.equals(buf2), 'success anyway')
    })
  })
  t.end()
})

tap.test('Given maxSize less than target entry file size', t => {
  const entry = 'x/y/rand-bytes.bin'
  t.rejects(
    readEntry(fxs.naturalTgz, entry, { maxSize: 1000 }),
    { message: /^Limit of 1000 bytes exceeded /, code: 'EFBIG' }
  )
  t.end()
})

function readNextItem (t, tarball, entryList, i) {
  if (i >= entryList.length) return t.end()
  // Workaround for directory entries in entryList:
  // Scan for an entry that does not end with '/' before doing tests
  while (entryList[i].slice(-1) == '/') {
    if (++i >= entryList.length) return t.end()
  }
  return readEntry(tarball, entryList[i], {})
  .then(buf1 => {
    const entryPath = path.resolve(extractPath, entryList[i])
    return readFile(entryPath).then(buf2 => {
      // "If no encoding is specified, then the raw buffer is returned."
      t.ok(buf1.equals(buf2), entryList[i] + ' should match fs copy')
      readNextItem(t, tarball, entryList, i + 1)
    })
  })
}

tap.test('Read gzipped tarball entry data to buffer and validate', t => {
  readNextItem(t, fxs.naturalTgz, fxs.naturalEntries, 0)
})

tap.test('Read naked tarball entry data to buffer and validate', t => {
  readNextItem(t, fxs.constructedTar, fxs.constructedEntries, 0)
})

// Coverage: unbzip2-stream instances do not have unpipe, so if we find the
// target entry before end of entries, there's this code path that does not
// call unpipe
tap.test('Read bzip2-compressed tarball entry and validate', t => {
  const entry = 'a/b/c/passwords.txt'
  return readEntry(fxs.naturalTbz2, entry, { bzip2: true })
  .then(buf1 => {
    const entryPath = path.resolve(extractPath, entry)
    return readFile(entryPath).then(buf2 => {
      t.ok(buf1.equals(buf2), entry + ' should match fs copy')
    })
  })
})
// NOTE: in the case of an absolute-path entry, it is or isn't listed by
// command-line tar when the pattern is "*/filename" depending on options:
// * wildcards (wildcardsMatchSlash): yes, all "filename" (if dir, then + all under it)
// * wildcards wildcardsMatchSlash=false: only matches entry "/filename"
// * wildcards (wildcardsMatchSlash) recursion=false: only whole matches
//   (e.g. "*/crontab" gets /etc/crontab, but "/etc" gets nothing on same
//   tarball if there's no entry "/etc/")
// * wildcards wildcardsMatchSlash=false recursion=false: only whole matches

function testPatternMatch (t, pattern, opts, re_file) {
  const tarball = fxs.constructedTar
  const entryList = fxs.constructedEntries
  
  return readEntry(tarball, pattern, opts).then(tbBuf => {
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
    const entryPath = path.resolve(extractPath, entryMatch)

    return readFile(entryPath).then(fsBuf => {
      t.ok(tbBuf.equals(fsBuf), [
        'Passing "', pattern, '" with opts ', JSON.stringify(opts),
        ' to readEntry() should yield same contents as ', entryMatch
      ].join(''))
      t.end()
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
  return readEntry(fxs.naturalTgz, 'passwords.txt', opts).then(data => {
    console.warn = warn
    console.info = info
    console.log = log
    t.match(warningData, [
      { data: /WARN/, args: [ 'Invalid option(s) given:' ] },
      { data: /WARN/, args: [ 'yada, dada' ] }
    ])
    t.ok(data)
  })
})

tap.test('Invalid wildcard pattern given for filename', t => {
  t.rejects(
    readEntry(fxs.naturalTgz, '\n', { wildcards: true }),
    { message: /^Invalid match pattern / }
  )
  t.end()
})

tap.test('When there is no match', t => {
  const tarball = fxs.constructedTar
  t.rejects(
    readEntry(tarball, 'z/', null),
    { message: /No match for z\//, code: 'ENOMATCH' }
  )
  t.end()
})

tap.test('Option: anchored, default true vs explicitly set', t => {
  // 'anchored' (as defined in the tar man page, though ambiguously) is the
  // default behavior, but we must get the same behavior when it's explicitly
  // set to true.
  // Expect readEntry to wait to match the root entry passwords.txt, instead of
  // accepting the entry 'a/b/c/passwords.txt' that comes first in the archive:
  const tarball = fxs.constructedTar
  const searchKey = 'urtyegIlCid6' // Only to be found in the root passwords.txt
  return readEntry(tarball, 'passwords.txt').then(buf => {
    t.ok(
      buf.toString().includes(searchKey),
      `Only the root passwords.txt contains the string "${searchKey}"`
    )
    const opts = { wildcards: true, anchored: true }
    return readEntry(tarball, 'passwords.txt', opts).then(buf => {
      t.ok(
        buf.toString().includes(searchKey),
        `Only the root passwords.txt contains the string "${searchKey}"`
      )
    })
  })
})

tap.test('Option anchored = false', t => {
  // Expect readEntry to accept the entry 'a/b/c/passwords.txt' which appears
  // earlier in the archive, instead of waiting to match the root passwords.txt:
  const tarball = fxs.constructedTar
  const searchKey = 'ToksEgByRif3' // Only to be found in a/b/c/passwords.txt
  const opts = { wildcards: true, anchored: false }
  return readEntry(tarball, 'passwords.txt', opts).then(buf => {
    t.ok(
      buf.toString().includes(searchKey),
      `Only a/b/c/passwords.txt contains the string "${searchKey}"`
    )
  })
})

tap.test('Not a gzipped tarball', t => {
  t.rejects(
    readEntry(fxs.gzNotTar, 'a'),
    { message: 'Invalid entry for a tar archive', code: 'EFTYPE'}
  )
  t.end()
})

tap.test('Truncated tarball', t => {
  t.rejects(
    readEntry(fxs.brokenTgz, 'a/b/c'),
    { message: 'zlib: unexpected end of file', code: 'Z_BUF_ERROR' }
  )
  t.end()
})

tap.test('invalid values for valid options', t => {
  const badOpts = [
    { name: 'debug', value: 1 },
    { name: 'ignoreCase', value: 'y' },
    { name: 'wildcards', value: 'y' },
    { name: 'wildcardsMatchSlash', value: 'ok' },
    { name: 'anchored', value: 'only' }
  ]
  function nextBadOpt(i) {
    if (i >= badOpts.length) return t.end()
    const opt = badOpts[i]
    const optsArg = { [opt.name]: opt.value }
    return t.rejects(
      readEntry(fxs.naturalTgz, 'passwords.txt', optsArg),
      {
        message: `Invalid value type given for option "${opt.name}"`,
        code: 'EINVAL'
      }
    )
    .then(() => nextBadOpt(i + 1))
  }
  nextBadOpt(0)
})

