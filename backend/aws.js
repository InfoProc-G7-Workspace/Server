const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { S3Client } = require('@aws-sdk/client-s3');
const config = require('./config');

const credentials = {
  accessKeyId: config.awsAccessKeyId,
  secretAccessKey: config.awsSecretAccessKey,
};

const ddbClient = new DynamoDBClient({ region: config.awsRegion, credentials });
const ddb = DynamoDBDocumentClient.from(ddbClient);

const s3 = new S3Client({ region: config.awsRegion, credentials });

module.exports = { ddb, s3, credentials };
