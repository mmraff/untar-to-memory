var assert = require("assert")

const tap = require("tap")

const mkLogFn = require('../make-log-function')

tap.test("Bad arguments", t => {
  t.throws(
    () => mkLogFn(),
    {
      message: 'Must give minimum debug level as a string',
      code: 'ERR_ASSERTION'
    }
  )

  for (const arg of [ null, '', 42, true, {}, () => {} ])
    t.throws(
      () => mkLogFn(arg),
      {
        message: 'Must give minimum debug level as a string',
        code: 'ERR_ASSERTION'
      }
    )

  t.throws(
    () => mkLogFn('Bob'),
    {
      message: "Can't makeLogFunction with Bob",
      code: 'ERR_ASSERTION'
    }
  )

  t.end()
})

const messages = []
const makeConsoleTestFunc = level =>
  (data, ...args) => { messages.push({ level, data, args }) }
const testFuncs = {
  error: makeConsoleTestFunc('error'), warn: makeConsoleTestFunc('warn'),
  info: makeConsoleTestFunc('info'), log: makeConsoleTestFunc('verb')
}
const originalFuncs = {
  error: console.error, warn: console.warn,
  info: console.info, log: console.log
}
const useConsoleTestFuncs = () => {
  for (const fnName in testFuncs) console[fnName] = testFuncs[fnName]
}
const restoreConsoleFuncs = () => {
  for (const fnName in originalFuncs) console[fnName] = originalFuncs[fnName]
}

tap.test('Valid arguments', t => {
  const levels = [ 'error', 'warn', 'info', 'verbose' ]
  for (const cfgLevel of levels) {
    const log = mkLogFn(cfgLevel)
    t.type(log, 'function', `'${cfgLevel}' is a valid argument`)
    for (const arg of [ undefined, null, '', 42, true, {}, () => {} ])
      t.throws(
        () => log(arg, 'howdy'),
        `${arg === '' ? `""` : arg} not valid for level arg`
      )
    t.throws(
      () => log(undefined, 'Joe sent me'),
      'Log level must be a non-empty string'
    )
    messages.splice(0)
    console.error = testFuncs.error
    log('error', 65536)
    console.error = originalFuncs.error
    if (messages.length !== 1)
      t.fail('Log function failed to handle a number for a message')

    messages.splice(0)
    console.error = testFuncs.error
    log('error', { luckyNumber: 65536 })
    console.error = originalFuncs.error
    if (messages.length !== 1)
      t.fail('Log function failed to handle an object for a message')

    messages.splice(0)
    useConsoleTestFuncs()
    for (const logLevel of levels)
      log(logLevel, `Test message for level '${logLevel}'`)
    restoreConsoleFuncs()

    switch (cfgLevel) {
      case 'verbose':
        t.equal(
          messages.filter(item => item.level === 'verb').length, 1,
          'Single verbose-level message logged when set to verbose level'
        )
      case 'info':
        t.equal(
          messages.filter(item => item.level === 'info').length, 1,
          `Single info-level message logged when set to ${cfgLevel} level`
        )
      case 'warn':
        t.equal(
          messages.filter(item => item.level === 'warn').length, 1,
          `Single warn-level message logged when set to ${cfgLevel} level`
        )
      case 'error':
        t.equal(
          messages.filter(item => item.level === 'error').length, 1,
          `Single error-level message logged when set to ${cfgLevel} level`
        )
    }
    switch (cfgLevel) {
      case 'error':
        t.equal(
          messages.filter(item => 
            item.level === 'warn' ||
            item.level === 'info' ||
            item.level === 'verbose'
          ).length, 0,
          'No message lower than error-level logged when set to error level'
        )
      case 'warn':
        t.equal(
          messages.filter(item => 
            item.level === 'info' ||
            item.level === 'verbose'
          ).length, 0,
          'No message lower than warn-level logged when set to warn level'
        )
      case 'info':
        t.equal(
          messages.filter(item => item.level === 'verbose').length, 0,
          'No message lower than info-level logged when set to info level'
        )
    }
  }
  t.end()
})

