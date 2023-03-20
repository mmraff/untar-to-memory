const fs = require("fs")
const path = require("path")
const mkdirp = require("mkdirp")
const rimraf = require("rimraf")
const tar = require("tar")
const tap = require("tap")
const fxs = require("./fixtures/fixtures.js")

tap.test("Setup: extract the contents of the gzipped tarball", function(t) {
  const extractPath = path.resolve(__dirname, "fixtures", "tarball_base")
  rimraf(extractPath, function(err) {
    if (err) return t.bailout(err)
    mkdirp(extractPath, function(err) {
      if (err) return t.bailout(err)
      tar.x({ file: fxs.naturalTgz, C: extractPath })
      .then(() => t.end())
      .catch(err => t.bailout(err))
    })
  })
})

tap.test("Check that each entry source file is unique", function (t) {
  const entryList = fxs.naturalEntries
  let currBuf = null
  let i = 0

  function compareNext (j) {
    var path2 =
      path.resolve(__dirname, "fixtures", "tarball_base", entryList[j])

    fs.readFile(path2, function (err2, buf2) {
      if (err2) { t.fail(err2.message) }
      t.notOk(currBuf.equals(buf2),
        entryList[i]+" should be different than "+entryList[j])
      buf2 = null
      j++
      while (j < entryList.length) {
        if (entryList[j].slice(-1) !== '/') { break }
        j++
      }
      if (j < entryList.length) { return compareNext(j) }
      i++
      nextCase()
    })
  }

  function nextCase () {
    // Ensure we're not using readFile() on directory entries!
    while (i < entryList.length) {
      if (entryList[i].slice(-1) !== '/') { break }
      i++
    }
    if (i >= entryList.length) { return t.end() }

    var j = i + 1
    while (j < entryList.length) {
      if (entryList[j].slice(-1) !== '/') { break }
      j++
    }
    if (j >= entryList.length) { return t.end() }

    var path1 =
      path.resolve(__dirname, "fixtures", "tarball_base", entryList[i])

    fs.readFile(path1, function (err, buf) {
      if (err) { t.fail(err.message) }

      currBuf = buf;
      compareNext(j)
    })
  }

  nextCase()
})

