# untar-to-memory: Change Log

## 2.0 (2023-04-10)
- Methods now return Promises; callbacks dropped
- Dropped support for node.js less than v10
- Added options `maxSize`, `useCompressProgram`/`I`, `bzip`, `gzip`, `lzma`, `xz`
- Added handling for more errors cases; new error codes `ENOMATCH` and `EFBIG`

### Dependencies
* Added optionalDependencies bzip2-stream, lzma-native
* Updated minimatch spec from ^3.0.5 to ^3.1.2
* Removed graceful-fs

## 1.0.5 (2023-03-22)
Refactored for correctness and increased reliability. Highlights:
- Ensured the callback is only called once and from a single location
- Removed use of fs.close(fileDescriptor) because it's unreliable here;
  simply readStream.resume()
- Added option value checking
- list(): Filter out entries like `"a/"` for patterns like `"a/*"`, to match
  behavior of command line `tar -t`
- Enabled coverage testing, and expand tests to reach 100%
- Updated minimatch spec from 3.x to ^3.0.5

## 1.0.4 (2022-02-07)
- Replaced deprecated Buffer ctor use
- Added engines section to require node.js at least v5.10
- Updated tar spec from ~4.4.15 to ^4.4.19

## 1.0.3 (2021-09-13)
- Ensured readStream is closed before calling callback (issue #4)

## &lt; 1.0.3
Don't ask.
