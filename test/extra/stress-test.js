/*
  This is a special test to demonstrate issue #4, where a user reported
  seeing a memory leak in the form of an accumulation of unclosed file
  handles. It only manifests as a significant problem when a user program
  makes *many* calls to readEntry before the process finishes.
  (readEntry can terminate reading in the middle of the stream.)
*/

const { readEntry } = require('./index')

let count = 0

const int = setInterval(() =>
  readEntry(
    './test/fixtures/constructed.tar', 'passwords.txt', null,
    (err, buf) => console.log(`readEntry ${++count} ${err || 'OK'}`)
  ),
  10
)

setTimeout(() => clearInterval(int), 100000)

// in the mean time watch the growing number of opened files
// for example on linux:
// lsof -u $USER 2>/dev/null | cut -d" " -f1 | sort | uniq -c | grep node
