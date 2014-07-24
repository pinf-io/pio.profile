
const PATH = require("path");
const CRYPTO = require("crypto");
const FS = require("fs-extra");
const DEEPMERGE = require("deepmerge");
const WAITFOR = require("waitfor");
const ESCAPE_REGEXP = require("escape-regexp-component");

var DEBUG = false;

exports.decryptFile = function (filePath, options, callback) {

    if (!FS.existsSync(filePath)) {
        return callback("No file at path '" + filePath + "'!");
    }

    if (options.debug) {
        console.log("[pio-profile-encrypt] Processing file:", filePath);
    }

    var content = FS.readFileSync(filePath, "utf8");

    if (options.debug) {
        console.log("[pio-profile-encrypt] Looking for '[ENCRYPTED:<env-keys>:iv:encrypted]' to decrypt using secret '<env-keys>' (e.g. 'PIO_SEED_SALT+PIO_SEED_KEY')");
    }

    function decrypt(secret, encrypted, callback) {
        encrypted = encrypted.split(":");
        var secretHash = CRYPTO.createHash("sha256");
        secretHash.update(secret);
        var decrypt = CRYPTO.createDecipheriv('aes-256-cbc', secretHash.digest(), new Buffer(encrypted.shift(), 'hex'));
        var decrypted = decrypt.update(new Buffer(encrypted.join(":"), 'hex').toString('binary'), 'binary', 'utf8');
        decrypted += decrypt.final('utf8');
        return callback(null, decrypted);
    }

    var waitfor = WAITFOR.serial(function (err) {
        if (err) return callback(err);
        return callback(null, content);
    });

    var re = /\[ENCRYPTED:([^:]+):([^:]+:[^\]]+)\]/g;
    var m = null;
    while (m = re.exec(content)) {
        var secret = m[1].split("+").map(function (name) {
            if (!process.env[name]) {
                return callback("The '" + name + "' environment variable must be set! It is needed to encrypt a value.");
            }
            return process.env[name];
        }).join("+");
        return waitfor(function (callback) {
            return decrypt(secret, m[2], function(err, decrypted) {
                if (err) return callback(err);
                if (options.debug) {
                    console.log("Decrypted value: " + m[0]);
                }
                content = content.replace(new RegExp(ESCAPE_REGEXP(m[0]), "g"), decrypted);
                return callback(null);
            });
        });
    }
    return waitfor();
}



function main (callback) {
    if (process.argv.length <= 2) {
        return callback("Usage: pio-profile-decrypt <file-path>");
    }
    return exports.decryptFile(process.argv[2], {
        debug: DEBUG
    }, function (err, content) {
        if (err) return callback(err);
        process.stdout.write(content);
        return callback(null);
    });
}


if (require.main === module) {
    main(function(err) {
        if (err) {
            if (typeof err === "string") {
                console.error((""+err));
            } else
            if (typeof err === "object" && err.stack) {
                console.error((""+err.stack));
            }
            process.exit(1);
        }
        process.exit(0);
    });
}
