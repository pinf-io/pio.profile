
const PATH = require("path");
const CRYPTO = require("crypto");
const FS = require("fs-extra");
const DEEPMERGE = require("deepmerge");
const WAITFOR = require("waitfor");
const ESCAPE_REGEXP = require("escape-regexp-component");
const MINIMIST = require("minimist");


const VERBOSE = !!process.env.VERBOSE;


function main (ARGS, callback) {

    if (ARGS._.length !== 1) {
        return callback("Usage: pio-profile-encrypt <file-path>");
    }

    var filePath = ARGS._[0];

    if (!FS.existsSync(filePath)) {
        return callback("No file at path '" + filePath + "'!");
    }

    if (VERBOSE) console.error("[pio-profile-encrypt] Processing file:", filePath);

    var content = FS.readFileSync(filePath, "utf8");

    if (VERBOSE) console.error("[pio-profile-encrypt] Looking for '[ENCRYPT:<env-keys>:value]' to encrypt using secret '<env-keys>' (e.g. 'PIO_SEED_SALT+PIO_SEED_KEY')");

    function encrypt(secret, decrypted, callback) {
        return CRYPTO.randomBytes(32, function (err, buffer) {
            if (err) return callback(err);
            var iv = CRYPTO.createHash("md5");
            iv.update(buffer.toString("hex"));
            iv = iv.digest();
            var secretHash = CRYPTO.createHash("sha256");
            secretHash.update(secret);
            var encrypt = CRYPTO.createCipheriv('aes-256-cbc', secretHash.digest(), iv);
            var encrypted = encrypt.update(decrypted, 'utf8', 'binary');
            encrypted += encrypt.final('binary');
            return callback(null, iv.toString('hex') + ":" + new Buffer(encrypted, 'binary').toString('hex'));
        });
    }

    var found = 0;

    var waitfor = WAITFOR.serial(function (err) {
        if (err) return callback(err);

        FS.writeFileSync(filePath, content, "utf8");

        if (
            found > 0 &&
            ARGS.noexit !== true
        ) {
            return callback("##############################\n\nACTION: We encrypted a value in '" + filePath + "' that must be included in the commit! Please add the change and commit again.\n\n##############################\n");
        }

        return callback(null);
    });

    // TODO: Look for '[DECRYPT' to decrypt a value and keep it in plain text until it is changed to '[ENCRYPT'.
    var re = /\[ENCRYPT:([^:]+):([^\]]+)\]/g;
    var m = null;
    while (m = re.exec(content)) {
        var secret = m[1].split("+").map(function (name) {
            if (!process.env[name]) {
                return callback("The '" + name + "' environment variable must be set! It is needed to encrypt a value.");
            }
            return process.env[name];
        }).join("+");
        waitfor(secret, m, function (secret, m, callback) {
            return encrypt(secret, m[2], function(err, encrypted) {
                if (err) return callback(err);
                found += 1;
                if (VERBOSE) console.error("Encrypted value: " + m[0]);
                content = content.replace(new RegExp(ESCAPE_REGEXP(m[0]), "g"), "[ENCRYPTED:" + m[1] + ":" + encrypted + "]");
                return callback(null);
            });
        });
    }
    return waitfor();
}


if (require.main === module) {

    const ARGS = MINIMIST(process.argv.slice(2), {
        boolean: [
            "noexit"
        ]
    });

    main(ARGS, function(err) {
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

