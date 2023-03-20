# untar-to-memory
npm module for reading stuff from tarballs without writing to the filesystem.

The aim of this module is to mimic the read-oriented behavior of command-line
[tar](http://www.gnu.org/software/tar/manual/tar.html).

_Command-line **tar** takes a multitude of options, not all of which are currently
implemented in this module._

## Installation

    npm install untar-to-memory

## Usage

```js
const untar = require('untar-to-memory')

const tgzPath = path.resolve("path", "to", "tarball1.tgz")

// Verbatim entry specification - null for options gets defaults
untar.readEntry(tgzPath, "secret/passwords.bin", null, (er, buf) => {
  // ...
})

const tarPath = path.resolve("another", "path", "tarball2.tar")
const opts = { ignoreCase: true, wildcards: true, wildcardsMatchSlash: false }

// Get the contents of the first "keys.txt" entry that is directly under a
// top level directory in the tarball, regardless of the entry name case:
untar.readEntry(tarPath, "*/KEYS.TXT", opts, (er, buf) => {
  // ...
})

// Get list of all entries from tarball2.tar
untar.list(tarPath, null, (er, allEntries) => {
  if (er) { /* error handling... */ }
  for (let i = 0; i < allEntries.length; i++) {
    // ...
  }
})

// Get list of only the entries directly under "secret/" in tarball1.tgz
const opts = {
  pattern: "secret/*", wildcards: true, wildcardsMatchSlash: false,
  recursion: false
}
untar.list(tgzPath, opts, function(er, topSecrets) {
  // ...
})

```

## API

### readEntry (tarball, filename, options, callback)

* `tarball` String: path to a **tar** archive, which can be either uncompressed or gzipped.
* `filename` String: path pattern to match an entry in the tarball.
* `options` Object: settings corresponding to command-line **tar** options,
  to control pattern matching. Valid fields:
  + `ignoreCase` default: false
  + `wildcards` default: false
  + `wildcardsMatchSlash` default: true
* `callback` Function: args (`error`, `buffer`) where buffer is a node.js **Buffer**
  holding the data contents of the entry if successful.

Use of this function corresponds roughly to using operation mode `x`
(`--extract`, `--get`) of command-line **tar** with option `-O` (`--to-stdout`).

Some possible errors:
  - EINVAL: invalid argument/option value.
  - EFTYPE: the tarball has an invalid entry, or it's not a tar archive.
  - ENOENT: the tarball path was not found, or readEntry() found no match.

If error with error.code ENOENT is returned through the callback, user should check for error.pattern to distinguish between no-such-tarball and no-such-entry. *Deprecated: a new error code for no-such-entry will be added in the next minor/major version.*


### list (tarball, options, callback)

* `tarball` String: path to a **tar** archive, which can be 'naked' or gzipped.
* `options` Object: settings corresponding to command-line **tar** options,
  to control pattern matching. Valid fields:
  + `pattern` default: ''; if empty, all entries will be matched.
  + `ignoreCase` default: false
  + `wildcards` default: false
  + `wildcardsMatchSlash` default: true if `wildcards` false, otherwise true
  + `recursion` default: true
  + `anchored` default: true
* `callback` Function: args (`error`, `entries`) where `entries` is an array of
  entry names that matched (possibly none) if successful.

## Pattern Matching Control

For an authoritative discussion and examples, see the
[tar manual page at gnu.org](https://www.gnu.org/software/tar/manual/html_node/controlling-pattern_002dmatching.html)

