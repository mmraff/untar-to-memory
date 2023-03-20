var path = require("path")

exports.brokenTgz = path.resolve(__dirname, "broken-natural.tgz")
exports.gzNotTar = path.resolve(__dirname, "rand-bytes.bin.gz")
exports.notTarball = path.resolve(__dirname, "passwords.txt")

exports.naturalTgz = path.resolve(__dirname, "natural.tgz")
exports.naturalEntries = [
  "a/",
  "a/b/",
  "a/b/f/",
  "a/b/f/rand-base64.txt",
  "a/b/f/g/",
  "a/b/c/",
  "a/b/c/passwords.txt",
  "a/b/c/d/",
  "a/b/c/d/rand-base64.txt",
  "a/b/c/d/e/",
  "npm-debug.log",
  "passwords.txt",
  "x/",
  "x/y/",
  "x/y/z/",
  "x/y/rand-bytes.bin",
  "x/passwords.txt"
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

