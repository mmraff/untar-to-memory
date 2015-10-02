// TODO: ignoreCase tests

var tap = require("tap")
  , untar = require("../index.js")
  , fs = require("fs")
  , path = require("path")
  , fxs = require("./fixtures/fixtures.js")

tap.test("validate list() on gzipped tarball", function (t) {
  var tarball = fxs.naturalTgz
    , entryList = fxs.naturalEntries

  untar.list(tarball, null, function(er, data) {
    if (er) { t.fail(er.message) }
    else {
      t.same(data, entryList,
        "list() with no opts should yield same as fixtures entry list")
    }
    t.end()
  })
})

tap.test("validate list() on naked tarball", function (t) {
  var tarball = fxs.constructedTar
    , entryList = fxs.constructedEntries

  untar.list(tarball, null, function(er, data) {
    if (er) { t.fail(er.message) }
    else {
      t.same(data, entryList,
        "list() with no opts should yield same as fixtures entry list")
    }
    t.end()
  })
})

function testUntarListVsRegex (t, tarball, opts, list, re, next)
{
  untar.list(tarball, opts, function(er, data) {
    if (er) { t.fail(er.message) }
    else {
      var filteredList = []
      for (var i = 0; i < list.length; i++) {
        if (re.test(list[i])) { filteredList.push(list[i]) }
      }
      t.same(data, filteredList, [
        "list() with opts ", JSON.stringify(opts),
        " should yield same as fixtures entry list filtered by ", re.toString()
      ].join(''))
    }
    next()
  })
}

tap.test("validate yield of list() with verbatim patterns", function (t) {
  var tarball = fxs.naturalTgz
    , entryList = fxs.naturalEntries
    , pattern = "npm-debug.log" // A file entry

  // +"(?:\/.*)?$" ensures that the end of the verbatim pattern only matches
  // the end of a path component.
  testUntarListVsRegex(
    t, tarball, {pattern: pattern}, entryList,
    new RegExp('^'+pattern+"(?:\/.*)?$"), next
  )

  function next ()
  {
    pattern = "a/b/c/d" // A non-empty directory entry
    testUntarListVsRegex(
      t, tarball, {pattern: pattern}, entryList,
      new RegExp('^'+pattern+"(?:\/.*)?$"), function() { t.end() }
    )
  }
})

tap.test("validate yield of list() with non-anchored pattern", function (t) {
  var tarball = fxs.naturalTgz
    , entryList = fxs.naturalEntries
    , opts = { pattern: "passwords.txt", anchored: false }
    , re = new RegExp("^(?:.*\/)?" + opts.pattern + '$')

  testUntarListVsRegex(t, tarball, opts, entryList, re, function() { t.end() })
})

tap.test("validate yield of list() with ignoreCase option", function (t) {
  var tarball = fxs.naturalTgz
    , entryList = fxs.naturalEntries
    , opts = { pattern: "PaSsWoRdS.txt", anchored: false, ignoreCase: true }
    , re = new RegExp("^(?:.*\/)?" + opts.pattern + '$', 'i')

  testUntarListVsRegex(t, tarball, opts, entryList, re, function() { t.end() })
})

// In the following...
// GS == Globstar; NoGS == NoGlobstar; NoR == NoRecursion
var wcOptions = {
    reGS: { wildcards: true }
  , reNoGS: { wildcards: true, wildcardsMatchSlash: false }
  , reGSNoR: { wildcards: true, recursion: false }
  , reNoGSNoR: { wildcards: true, wildcardsMatchSlash: false, recursion: false }
}
var wcPatterns = [
    { untar: "*/*.txt"
    , reGS: /^.*\/[^\/]*\.txt\/?$/
    , reNoGS: /^[^\/]*\/[^\/]*\.txt\/?$/
    , reGSNoR: /^.*\/[^\/]*\.txt$/
    , reNoGSNoR: /^[^\/]*\/[^\/]*\.txt$/
    }
  , { untar: "*/rand-*"
    , reGS: /^.*\/rand-.*/
    , reNoGS: /^[^\/]*\/rand-.*/
    , reGSNoR: /^.*\/rand-[^\/]*$/
    , reNoGSNoR: /^[^\/]*\/rand-[^\/]*$/
    }
  , { untar: "*/c"
    , reGS: /^.*\/c(?:\/.*)?$/
    , reNoGS: /^[^\/]*\/c(?:\/.*)?$/
    , reGSNoR: /^.*\/c\/?$/
    , reNoGSNoR: /^[^\/]*\/c\/?$/
    }
/* TEMPLATE
  , { untar: 
    , reGlobstar: 
    , reNoGlobstar: 
    , reGSNoR: 
    , reNoGSNoR: 
    }
*/
]

var p = 0;

tap.test("Give list() a workout with option combinations", function (t) {
  var tarball = fxs.naturalTgz
    , entryList = fxs.naturalEntries
    , pattern = wcPatterns[0].untar
    , opts = { pattern: pattern, wildcards: true }

  testUntarListVsRegex(
    t, tarball, opts, entryList, wcPatterns[p].reGS, do_reNoGS
  )

  function do_reNoGS ()
  {
    opts.wildcardsMatchSlash = false;
    testUntarListVsRegex(
      t, tarball, opts, entryList, wcPatterns[p].reNoGS, do_reNoGSNoR
    )
  }

  function do_reNoGSNoR ()
  {
    opts.recursion = false;
    testUntarListVsRegex(
      t, tarball, opts, entryList, wcPatterns[p].reNoGSNoR, do_reGSNoR
    )
  }

  function do_reGSNoR ()
  {
    delete opts.wildcardsMatchSlash;
    testUntarListVsRegex(
      t, tarball, opts, entryList, wcPatterns[p].reGSNoR, next
    )
  }

  function next ()
  {
    p++
    if (p >= wcPatterns.length) {
      if (tarball === fxs.constructedTar) { return t.end() }
      tarball = fxs.constructedTar
      entryList = fxs.constructedEntries
      p = 0
    }

    delete opts.recursion;
    opts.pattern = wcPatterns[p].untar
    testUntarListVsRegex(
      t, tarball, opts, entryList, wcPatterns[p].reGS, do_reNoGS
    )
  }
})

