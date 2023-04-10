# untar-to-memory
npm module for reading stuff from tarballs without writing to the filesystem.

The aim of this module is to mimic the read-oriented behavior of command-line
[tar](http://www.gnu.org/software/tar/manual/tar.html).

_Command-line **tar** takes a multitude of options, not all of which are currently
implemented in this module._

## Installation
```
npm install untar-to-memory
```
There are optional dependencies that provide decompression of bzip2-, LZMA-,
and XZ-compressed tarballs. If your project will rely on one of these,
be sure to install them as regular dependencies *instead* of using
`--include optional` when you install untar-to-memory:
```
npm install unbzip2-stream
```
For LZMA and/or XZ:
```
npm install lzma-native
```

## Usage

```js
const untar = require('untar-to-memory')

const tgzPath = path.resolve("path", "to", "tarball1.tgz")

// Verbatim entry specification - options omitted gets defaults
untar.readEntry(tgzPath, "secret/passwords.bin").then(buf => {
  // ...
})

const tarPath = path.resolve("another", "path", "tarball2.tar")
const opts = { ignoreCase: true, wildcards: true, wildcardsMatchSlash: false }

// Get the contents of the first "keys.txt" entry that is directly under a
// top level directory in the tarball, regardless of the entry name case:
untar.readEntry(tarPath, "*/KEYS.TXT", opts).then(buf => {
  // ...
})

// Get list of all entries from tarball2.tar
untar.list(tarPath).then(allEntries => {
  for (let i = 0; i < allEntries.length; i++) {
    // ...
  }
})

// Get list of only the entries directly under "secret/" in tarball1.tgz
const opts = {
  pattern: "secret/*", wildcards: true, wildcardsMatchSlash: false,
  recursion: false
}
untar.list(tgzPath, opts).then(topSecrets => {
  // ...
})

```

## API
Both methods return Promises. *Some* possible error codes if the Promise rejects are:
  - EINVAL: invalid argument/option value.
  - EFTYPE: the tarball has an invalid entry, or the file type is not recognized.
  - ENOENT: the tarball path was not found.
  - ENOMATCH: no entry was found to match the entry path/pattern as given.
  - EFBIG (`readEntry` only): the matching entry is bigger than the `maxSize`
   set by the user.

### `readEntry (tarball, filename, options)` &rarr; `Promise<Buffer>`

* `tarball` {string}: path to a **tar** archive, which may or may not be compressed.
* `filename` {string}: path pattern to match an entry in the tarball.
* `options` {object}: settings to control pattern matching.
  *Mostly corresponding to command-line **tar** options.*

  Valid fields:
  + `anchored`: default `true`
  + `ignoreCase`: default `false`
  + `maxSize`: default `0` (meaning unlimited)
  + `recursion`: default `true`
  + `useCompressProgram`/`I`: default `''` (autodetection for gzip)
    - other valid values are `'bzip'`, `'gzip'`, `'lzma'`, `'xz'`
  + `bzip`/`gzip`/`lzma`/`xz`: default `false`
  + `wildcards`: default `false`
  + `wildcardsMatchSlash`: default `false`, `true` if `wildcards` is `true`

Resolves to a **Buffer** holding the contents of the entry if successful.

Use of this function roughly corresponds to using operation mode `x`
(`--extract`, `--get`) of command-line **tar** with option `-O` (`--to-stdout`)
to extract a single specified file.

### `list (tarball, options)` &rarr; `Promise<Array>`

* `tarball` {string}: path to a **tar** archive, which may or may not be compressed.
* `options` {object}: settings to control pattern matching.
  *Mostly corresponding to command-line **tar** options.*

  Valid fields:
  + `anchored`: default `true`
  + `ignoreCase`: default `false`
  + `pattern`: default `''`; if empty, all entries will be matched.
  + `recursion`: default `true`
  + `useCompressProgram`/`I`: default `''` (autodetection for gzip)
    - other valid values are `'bzip'`, `'gzip'`, `'lzma'`, `'xz'`
  + `bzip`/`gzip`/`lzma`/`xz`: default `false`
  + `wildcards`: default `false`
  + `wildcardsMatchSlash`: default `false`, `true` if `wildcards` is `true`

Resolves to an array of matched entry paths (possibly empty) if successful.<br>
It is *not* treated as an error if there are no matches.

## Pattern Matching Control

For an authoritative discussion and examples, see the
[tar manual page at gnu.org](https://www.gnu.org/software/tar/manual/html_node/controlling-pattern_002dmatching.html)

------

**License: Artistic 2.0**

