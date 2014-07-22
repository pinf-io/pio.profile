
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("fs-extra");
const CRYPTO = require("crypto");
const Q = require("q");


var sycnedFiles = {};

exports.ensure = function(pio, state) {

    var response = {
        ".status": "ready"
    };

    return pio.API.Q.fcall(function() {

        if (!state["pio"].profileRegistryUri) {
            if (state["pio.cli.local"].verbose) {
                console.log("Skip profile sync because 'pio.profileRegistryUri' not set!");
            }
            return;
        }

        var config = pio.API.DEEPCOPY(pio.getConfig("config")["pio.profile"]);
        if (!config) {
            if (state["pio.cli.local"].verbose) {
                console.log("Skip profile sync because np config found for service 'pio.profile'!");
            }
            return;
        }

        if (!config.profileKey) {
            if (state["pio.cli.local"].verbose) {
                console.log("Skip profile sync because the 'PIO_PROFILE_KEY' environment variable is not set!");
            }
            return;
        }

        if (!config.profileSecret) {
            if (state["pio.cli.local"].verbose) {
                console.log("Skip profile sync because the 'PIO_PROFILE_SECRET' environment variable is not set!");
            }
            return;
        }

        if (!config.adapters) {
            if (state["pio.cli.local"].verbose) {
                console.log("Skip profile sync because no adapters declared!");
            }
            return;
        }

        ASSERT.equal(typeof state["pio"].hostname, "string", "'state[pio].hostname' must be set!");

        // TODO: Get this from context.
        var workspaceRootPath = PATH.dirname(pio._configPath);
        var profilePath = process.env.PIO_PROFILE_PATH;
        var activatePath = PATH.join(workspaceRootPath, "../", PATH.basename(workspaceRootPath) + ".activate.sh");

        // TODO: Upload for each adapter. For now we assume 'aws'.
        ASSERT.equal(typeof config.adapters.aws, "object", "'config.adapters.aws' must be set!");

        // TODO: Use `require.async`.
        var adapter = require("./adapters/aws");
        if (!adapter) {
            console.error("ERROR: Could not load adapter '" + "./adapters/" + "aws" + "'!");
        }
        if (!adapter.adapter) {
            console.error("ERROR: Adapter '" + "./adapters/" + "aws" + "' does not export 'adapter.adapter'!");
        }

        var settings = Object.create(config.adapters.aws);
        settings.repositoryUri = state["pio"].profileRegistryUri + "/" + config.profileKey;

        var adapter = new adapter.adapter(settings);

        var files = [
            profilePath,
            activatePath
        ];

        if (state["pio.cli.local"].verbose) {
            console.log(("Syncing profile files using adapter '" + "aws" + "': " + JSON.stringify(files, null, 4)).magenta);
        }

        var secretHash = CRYPTO.createHash("sha256");
        secretHash.update(config.profileKey + ":" + config.profileSecret);
        secretHash = secretHash.digest();

        function encrypt(decrypted) {
            return Q.denodeify(CRYPTO.randomBytes)(32).then(function (buffer) {
                var iv = CRYPTO.createHash("md5");
                iv.update(buffer.toString("hex") + ":" + config.profileKey);
                iv = iv.digest();
                var encrypt = CRYPTO.createCipheriv('aes-256-cbc', secretHash, iv);
                var encrypted = encrypt.update(decrypted, 'utf8', 'binary');
                encrypted += encrypt.final('binary');
                return iv.toString('hex') + ":" + new Buffer(encrypted, 'binary').toString('base64');
            });
        }

        function decrypt(encrypted) {
            return Q.fcall(function () {
                encrypted = encrypted.split(":");
                var decrypt = CRYPTO.createDecipheriv('aes-256-cbc', secretHash, new Buffer(encrypted.shift(), 'hex'));
                var decrypted = decrypt.update(new Buffer(encrypted.join(":"), 'base64').toString('binary'), 'binary', 'utf8');
                decrypted += decrypt.final('utf8');
                return decrypted;
            });
        }

        function checkFile (file) {

            if (sycnedFiles[file]) {
                return;
            }
            sycnedFiles[file] = true;

            var cachePath = PATH.join(workspaceRootPath, ".pio.cache/pio.profile", PATH.basename(file) + "~mtime");

            if (state["pio.cli.local"].verbose) {
                console.log("Checking file '" + file + "' using cache path '" + cachePath + "'");
            }

            if (FS.existsSync(file)) {
                if (FS.existsSync(cachePath)) {
                    if (parseInt(FS.readFileSync(cachePath).toString()) >= Math.ceil(FS.statSync(file).mtime.getTime()/1000) ) {
                        return;
                    }
                }

                return encrypt(FS.readFileSync(file)).then(function (encrypted) {
                    return adapter.upload(PATH.basename(file), encrypted).then(function () {
                        FS.outputFileSync(cachePath, Math.ceil(FS.statSync(file).mtime.getTime()/1000));
                        return;
                    });
                });
            }

            return adapter.download(PATH.basename(file)).then(function (encrypted) {
                if (!encrypted) {
                    return;
                }

                return decrypt(encrypted).then(function (decrypted) {
                    FS.outputFileSync(file, decrypted);
                    FS.outputFileSync(cachePath, Math.ceil(FS.statSync(file).mtime.getTime()/1000));
                    return;
                });
            });
        }

        return Q.all(files.map(checkFile));

    }).fail(function(err) {
        err.mesage += " (while syncing profile)";
        err.stack += "\n(while syncing profile)";
        throw err;
    }).then(function() {
        return pio.API.Q.resolve({
            "pio.profile": response
        });
    });
}
