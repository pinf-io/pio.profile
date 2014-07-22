
const ASSERT = require("assert");
const PATH = require("path");
const URL = require("url");
const CRYPTO = require("crypto");
const Q = require("q");
const AWS = require("aws-sdk");

// http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/frames.html

var adapter = exports.adapter = function(settings) {

    var self = this;

    self._settings = settings;

    ASSERT.equal(typeof self._settings.repositoryUri, "string");
    ASSERT.equal(typeof self._settings.accessKeyId, "string");
    ASSERT.equal(typeof self._settings.secretAccessKey, "string");
    ASSERT.equal(typeof self._settings.region, "string");

    var parsedRepositoryUri = URL.parse(self._settings.repositoryUri);
    var pathSegments = parsedRepositoryUri.pathname.substring(1).split("/");

    self._bucket = pathSegments.shift();
    self._namespace = pathSegments.join("/");

    ASSERT.ok(/amazonaws\.com$/.test(parsedRepositoryUri.host), "'parsedRepositoryUri.host' must be set to '*.amazonaws.com'");

    var awsConfig = new AWS.Config({
        accessKeyId: self._settings.accessKeyId,
        secretAccessKey: self._settings.secretAccessKey,
        region: self._settings.region
    });

    self._api = {
        s3: new AWS.S3(awsConfig)
    };

    self._ready = Q.defer();
    self._ready.resolve();
}

adapter.prototype.upload = function(filename, data) {
    var self = this;
    return self._ready.promise.then(function() {
        return Q.denodeify(function (callback) {
            return self._api.s3.putObject({
                ACL: "public-read",
                Bucket: self._bucket,
                ContentType: "text/plain",
                Key: PATH.join(self._namespace, filename),
                Body: new Buffer(data)
            }, function (err, data) {
                if (err) {
                    console.log("Error uploading to AWS using key:", self._settings.accessKeyId);
                    return callback(err);
                }
                console.log("Uploaded profile to:", PATH.join(self._bucket, self._namespace, filename));
                return callback(null);
            });
        })();
    });
}

adapter.prototype.download = function(filename) {
    var self = this;
    return self._ready.promise.then(function() {
        return Q.denodeify(function (callback) {
            return self._api.s3.getObject({
                Bucket: self._bucket,
                Key: PATH.join(self._namespace, filename),
            }, function (err, data) {
                if (err) {
                    if (err.code === "NoSuchKey") {
                        return callback(null, null);
                    }
                    console.log("Error uploading to AWS using key:", self._settings.accessKeyId);
                    return callback(err);
                }
                return callback(null, data.Body.toString());
            });
        })();
    });
}
