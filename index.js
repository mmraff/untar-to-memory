var tar = require("tar")
  , fs = require("graceful-fs")
  , zlib = require("zlib")
  , assert = require("assert")
  ;

exports.readEntry = readEntry;
exports.list = listEntries;

function listEntries(tarball, opts, cb)
{
  assert(typeof tarball === "string" && tarball.length,
         "Must give path to tarball");
  assert(typeof cb === "function", "Must give callback");

  var params = {}
    ;
  if (opts) { for (var key in opts) { params[key] = opts[key]; } }
  checkHeader(tarball, params, getList, cb);
}

function readEntry (tarball, filename, opts, cb)
{
  assert(typeof tarball === "string" && tarball.length,
         "Must give path to tarball");
  assert(typeof filename === "string" && filename.length,
         "Must give name of file to seek");
  assert(typeof cb === "function", "Must give callback");

  var params = {}
    ;
  if (opts) { for (var key in opts) { params[key] = opts[key]; } }
  params.seekname = filename;
  checkHeader(tarball, params, getFileBuffer, cb);
}

function checkHeader(tarball, params, next, cb0)
{
  function cb1 (er, data) {
    if (cbCalled) return;
    cbCalled = true;
    cb0(er, data);
  }

  var cbCalled = false
    , fst = fs.createReadStream(tarball)
    ;
  fst.on("open", function (fd) {
    fs.fstat(fd, function (er, st) {
      if (er) return fst.emit("error", er);
      if (st.size === 0) {
        er = new Error("0-byte file " + tarball);
        fst.emit("error", er)
      }
    })
  })
  .on("error", function (er) {
    if (er) {
      if (er.code === "ENOENT") {
        er.message = "tar archive not found: "+tarball;
      }
    }
    else { er = "Unknown error event while reading " + tarball; }
    // But when would there ever be an error event without an error object?
    cb1(er)
  })
  .on("data", function OD (c) {
    params.tarballpath = tarball;
    // gzipped tarball or a naked tarball? or not a tarball?
    // gzipped files all start with 1f8b08
    if (c[0] === 0x1F &&
        c[1] === 0x8B &&
        c[2] === 0x08) {

      next(fst.pipe(zlib.Unzip()), params, cb1);
    }
    else if (hasTarHeader(c)) { next(fst, params, cb1); }

    else { cb1(new Error("Not a tarball: " + tarball)); }

    // Finished check.
    // We're still on the 1st chunk, so we can restart:
    fst.removeListener("data", OD)
    fst.emit("data", c)
  });
}

function getFileBuffer(fst, params, cb)
{
  var gettingIt = false
    , content = null
    , start = 0
    , err = null
    ;
  // To weed out bad values of strip
  params.strip = +params.strip
  if (!params.strip || params.strip <= 0) { delete params.strip; }

  fst.pipe(tar.Parse())
    .on("entry", function(entry) {
      // It's meaningless to send back non-file data
      if (entry.type !== 'File') { return; }
      var p = entry.path;
      if (params.strip) {
        p = p.split("/").slice(params.strip).join("/");
        if (!p) { return; }
      }
      var isMatch = params.ignoreCase ?
        (p.toLowerCase() == params.seekname.toLowerCase()) :
        (p === params.seekname);
      if (isMatch) {
        gettingIt = true;
        content = new Buffer(entry.size);
      }
      else if (gettingIt) {
        gettingIt = false;
        this.emit("end");
      }
    })
    .on("data", function(data) {
      if (!gettingIt) { return; }
      data.copy(content, start, 0, data.length);
      start += data.length;
    })
    .on("error", function (er) {
      err = er || new Error("unknown parse error");
      if (!err.path) { err.path = params.tarballpath; }
      this.emit("end");
    })
    .on("end", function() {
      if (!content) {
        err = new Error(params.seekname+" not found in archive "+params.tarballpath);
        err.code = "ENOENT";
        err.path = params.seekname;
        return cb(err);
      }
      cb(err, content);
    });
}

function getList(fst, params, cb)
{
  var list = []
    , err = null
    ;
  // To weed out bad values of strip
  params.strip = +params.strip
  if (!params.strip || params.strip <= 0) { delete params.strip; }

  fst.pipe(tar.Parse())
    .on("entry", function(entry) {
      var p = entry.path;
      if (params.strip) {
        p = p.split("/").slice(params.strip).join("/");
        if (!p) { return; }
      }
      list.push(p);
    })
    .on("error", function (er) {
      err = er || new Error("unknown parse error");
      if (!err.path) { err.path = params.tarballpath; }
      this.emit("end");
    })
    .on("end", function() {
      cb(err, list);
    });
}

function hasTarHeader (c)
{
  return c[257] === 0x75 && // tar archives have 7573746172 at position
         c[258] === 0x73 && // 257 and 003030 or 202000 at position 262
         c[259] === 0x74 &&
         c[260] === 0x61 &&
         c[261] === 0x72 &&

       ((c[262] === 0x00 &&
         c[263] === 0x30 &&
         c[264] === 0x30) ||

        (c[262] === 0x20 &&
         c[263] === 0x20 &&
         c[264] === 0x00))
}

