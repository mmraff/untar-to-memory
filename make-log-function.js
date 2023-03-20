module.exports = makeLogFunc

const assert = require("assert")

const levelMap = {
  ERROR: 3, WARN: 2, INFO: 1, VERBOSE: 0
}

function makeLogFunc (minLevel) {
  assert(
    minLevel && typeof minLevel == "string",
    "Must give minimum debug level as a string"
  )
  var MINLEVEL = minLevel.toUpperCase()
  assert(MINLEVEL in levelMap, "Can't makeLogFunction with " + minLevel)

  return function (lvl, msg) {
    assert(typeof msg != "undefined",
           "Must give message/value to display")
    assert(typeof lvl == "string" && 0 < lvl.length,
           "debug level must be a non-empty string")

    var LVL = lvl.toUpperCase()
    assert(LVL in levelMap, `unrecognized debug level '${lvl}'`)

    if (levelMap[LVL] < levelMap[MINLEVEL]) { return }

    var fmt = (typeof msg == "number" ? "%d" :
              (typeof msg == "object" ? "%j" : "%s"))

    switch (LVL) {
      case "ERROR":
        console.error("\u001b[31mERR!\u001b[0m " + fmt, msg)
        break
      case "WARN":
        console.warn("\u001b[33mWARN\u001b[0m " + fmt, msg)
        break
      case "INFO":
        console.info("\u001b[32minfo\u001b[0m " + fmt, msg)
        break
      case "VERBOSE":
        console.log("\u001b[34;1mverb\u001b[0m " + fmt, msg)
        break
    }
  }
}

