var path = require("path")

exports.brokenTbz2 = path.resolve(__dirname, "broken.tar.bz2")
exports.brokenTgz = path.resolve(__dirname, "broken-natural.tgz")
exports.gzNotTar = path.resolve(__dirname, "rand-bytes.bin.gz")
exports.notTarball = path.resolve(__dirname, "passwords.txt")
exports.oneByte = path.resolve(__dirname, "one-byte")
exports.fakeTgz = path.resolve(__dirname, "fake.tgz")
exports.fakeBz2 = path.resolve(__dirname, "fake.bz2")

exports.naturalTgz = path.resolve(__dirname, "natural.tgz")
exports.naturalTbz2 = path.resolve(__dirname, "natural.tar.bz2")
exports.naturalTlzma = path.resolve(__dirname, "natural.tar.lzma")
exports.naturalTxz = path.resolve(__dirname, "natural.txz")
exports.naturalEntries = [
  "a/",
  "a/b/",
  "a/b/c/",
  "a/b/c/passwords.txt",
  "a/b/c/d/",
  "a/b/c/d/rand-base64.txt",
  "a/b/c/d/e/",
  "a/b/f/",
  "a/b/f/rand-base64.txt",
  "a/b/f/g/",
  "npm-debug.log",
  "passwords.txt",
  "x/",
  "x/passwords.txt",
  "x/y/",
  "x/y/z/",
  "x/y/rand-bytes.bin"
]
exports.constructedTar = path.resolve(__dirname, "constructed.tar")
exports.constructedEntries = [
  "x/y/rand-bytes.bin",
  "a/b/c/d/rand-base64.txt",
  "a/b/c/passwords.txt",
  "x/passwords.txt",
  "npm-debug.log",
  "passwords.txt",
  "a/b/f/rand-base64.txt"
]

