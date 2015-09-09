
const PATH = require("path");
const CRYPTO = require("crypto");
const FS = require("fs-extra");
const DEEPMERGE = require("deepmerge");
const WAITFOR = require("waitfor");
const ESCAPE_REGEXP = require("escape-regexp-component");
const COMMANDER = require("commander");

var DEBUG = false;


exports.forLib = function (LIB) {

    var exports = {};

    exports.decrypt = function (env, content) {
        return LIB.Promise.promisify(function (callback) {

            if (DEBUG) {
                console.log("[pio-profile-encrypt] Looking for '[ENCRYPTED:<env-keys>:iv:encrypted]' to decrypt using secret '<env-keys>' (e.g. 'PIO_SEED_SALT+PIO_SEED_KEY')");
            }
        
            function decrypt(secret, encrypted, callback) {
                try {
                    encrypted = encrypted.split(":");
                    var secretHash = CRYPTO.createHash("sha256");
                    secretHash.update(secret);
                    var decrypt = CRYPTO.createDecipheriv('aes-256-cbc', secretHash.digest(), new Buffer(encrypted.shift(), 'hex'));
                    var decrypted = decrypt.update(new Buffer(encrypted.join(":"), 'hex').toString('binary'), 'binary', 'utf8');
                    decrypted += decrypt.final('utf8');
                    return callback(null, decrypted);
                } catch(err) {
                    err.message += " (while decrypting)";
                    err.stack += "\n(while decrypting)";
                    return callback(err);
                }
            }
        
            var waitfor = WAITFOR.serial(function (err) {
                if (err) return callback(err);
                return callback(null, content);
            });
        
            var re = /\[ENCRYPTED:([^:]+):([^:]+:[^\]]+)\]/g;
            var m = null;
            while (m = re.exec(content)) {
                var secret = m[1].split("+").map(function (name) {
                    if (typeof env[name] === "undefined") {
                        return callback("The '" + name + "' environment variable must be set! It is needed to encrypt a value.");
                    }
                    return env[name];
                }).join("+");
                waitfor(secret, m, function (secret, m, callback) {
                    return decrypt(secret, m[2], function(err, decrypted) {
                        if (err) return callback(err);
                        if (DEBUG) {
                            console.log("Decrypted value: " + m[0]);
                        }
                        content = content.replace(new RegExp(ESCAPE_REGEXP(m[0]), "g"), decrypted);
                        return callback(null);
                    });
                });
            }
            return waitfor();
        })();
    }

    return exports;
}
