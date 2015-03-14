var elixir = require('laravel-elixir');
var utilities = require('laravel-elixir/ingredients/commands/Utilities');
var gulp = require('gulp');
var crypto = require('crypto');     // used to create hash string
var path = require('path');
var through = require('through2');
var gutil = require('gulp-util');
var del = require('del');

// This remembers WHEN a file was modified, and what their has was at the time.
var file_mtime = { };

/**
 * Returns a random string of characters of size length, this is faster than hashing a file.
 * @param length
 * @returns string
 */
function uuid(length) {
    length = length || 8;
    return Array(length + 1).join("x").replace(/x/g, function(c) {
        var r = Math.random()*16|0,v=c=='x'?r:r&0x3|0x8;return v.toString(16);
    });
}
/**
 * Gets the hash based on the given string.
 * @param   fileContents string
 * @param   length int
 * @returns string
 */
function fileHash(fileContents, length) {
    length = length || 8;

    var hashList = crypto.getHashes();
    var cipher = null;

    if(hashList.indexOf('md4') !== -1) {
        cipher = "md4";
    } else if (hashList.indexOf('md5') !== -1) {
        cipher = "md5";
    } else if (hashList.length > 0) {
        cipher = hashList[0];
    } else {
        return uuid(length);
    }

    var hash = crypto.createHash(cipher).update(fileContents).digest('hex');

    return hash.slice(0,length);
}

var getFileHash = function(getUUID) {
    return through.obj(function (file, enc, cb) {
        if (file.isNull()) {
            cb(null, file);
            return;
        }

        if (file.isStream()) {
            cb(new gutil.PluginError('laravel-elixir-cachebust', 'Streaming not supported'));
            return;
        }

        // Set a default of 0 if one does not exist.
        file_mtime[file.path] = (!file_mtime[file.path]) ? 0 : file_mtime[file.path];

        var current_mtime = file.stat.mtime.getTime();
        var saved_mtime =   file_mtime[file.path]["mtime"];
        var saved_hash =    file_mtime[file.path]['hash'];

        // If either the file was modified, OR the hash of the file does not exist
        // then get the hash of the file! (or uuid)
        if(current_mtime != saved_mtime || !(saved_hash))
        {
            var strHash = (getUUID === true) ? uuid(8) : fileHash(file.contents,8);

            file_mtime[file.path] = {
                mtime: current_mtime,   // saved_mtime = current_mtime;
                hash: strHash          // saved_hash = current_hash;
            };
        }

        file.hash = file_mtime[file.path]['hash'];
        cb(null, file);
    });
};

function writeCacheMap(jsonFile) {
    var output = {};
    var firstFile = null;

    return through.obj(function (file, enc, cb) {

        // If the file has no hash, that means it was not generated by getFileHash(),
        // ignore it.
        if(!file.hash) {
            cb();
            return;
        }


        var fileName = "/" + file.relative;
        output[fileName] = file.hash;
        firstFile = firstFile || file;

        cb();
    }, function (cb) {
        if (firstFile) {
            var buf = JSON.stringify(output, null, '  ');
            var newfile = new gutil.File({
                cwd: firstFile.cwd,
                base: firstFile.base,
                path: path.join(firstFile.base, jsonFile),
                contents: new Buffer(buf)
            });

            this.push(newfile);

        }

        cb();
    });

};

elixir.extend('cachebust',function(src, baseDir){

    baseDir = baseDir ? baseDir : 'public/';
    src = utilities.prefixDirToFiles(baseDir, src);
    var cacheBusterFile = "cachbuster.json";

    gulp.task("cache-busting", function() {

        return gulp.src( src, {base: './public'} )
            .pipe(getFileHash())
            .pipe(writeCacheMap(cacheBusterFile))
            .pipe(gulp.dest(baseDir));

    });

    this.registerWatcher("cache-busting",src);

    return this.queueTask("cache-busting");
});