
const PATH = require("path");
const CRYPTO = require("crypto");
const FS = require("fs-extra");
const DEEPMERGE = require("deepmerge");
const WAITFOR = require("waitfor");
const ESCAPE_REGEXP = require("escape-regexp-component");
const COMMANDER = require("commander");

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
            if (!process.env[name]) {
                return callback("The '" + name + "' environment variable must be set! It is needed to encrypt a value.");
            }
            return process.env[name];
        }).join("+");
        waitfor(secret, m, function (secret, m, callback) {
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

    var program = new COMMANDER.Command();

    program
        .usage('[options] <file>')
        .option("--format <name>", "How to show the output")
        .option("--write-to <path>", "Write decrypted data to file")
        .option("--user <name>", "Include user variables")
        .option("--overwrite-source", "Write decrypted data back to source file")
        .parse(process.argv);

    if (program.args.length < 1) {
        program.outputHelp();
        return callback();
    }

    return exports.decryptFile(program.args[0], {
        debug: DEBUG
    }, function (err, content) {
        if (err) return callback(err);

        if (program.writeTo) {
            return FS.outputFile(program.writeTo, content, callback);
        } else {
            if (program.overwriteSource) {
                return FS.outputFile(program.args[0], content, callback);
            } else {
                if (program.format === "source/env") {

                    var parsed = JSON.parse(content);
                    var env = parsed.env;

                    if (
                        program.user &&
                        parsed.user &&
                        parsed.user[program.user]
                    ) {
                        Object.keys(parsed.user[program.user]).forEach(function (name) {
                            env[name] = parsed.user[program.user][name];
                        });
                    }

                    for (var name in env) {
                        if (/^#/.test(name) && env[name] === "#") {
                            // Ignore comment line.
                        } else {
                            process.stdout.write('export ' + name + '="' + env[name] + '"\n');
                        }
                    }
                } else {
                    process.stdout.write(content);
                }
                return callback(null);
            }
        }
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
