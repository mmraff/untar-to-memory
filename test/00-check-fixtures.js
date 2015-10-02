var tap = require("tap")
  , fs = require("fs")
  , path = require("path")
  , fxs = require("./fixtures/fixtures.js")

tap.test("Check that each entry source file is unique", function (t) {
  var entryList = fxs.naturalEntries
    , currBuf = null
    , i = 0

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

