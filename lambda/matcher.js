const aws = require("aws-sdk");

const { wsEndpoint: endpoint, queueUrl } = process.env;

const client = new aws.ApiGatewayManagementApi({ endpoint });

const sqs = new aws.SQS();

function sendMessage(connectionIds, event) {
  return Promise.all(
    connectionIds.map((id) => {
      return client
        .postToConnection({
          ConnectionId: id,
          Data: Buffer.from(JSON.stringify({ event })),
        })
        .promise();
    })
  );
}

exports.handler = async (event) => {
  if (event.requestContext) {
    const connectionId = event.requestContext.connectionId;
    const routeKey = event.requestContext.routeKey;

    console.log(routeKey, connectionId);

    const response = await sqs
      .receiveMessage({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 2,
      })
      .promise();

    if (response.Messages) {
      // start game
      console.log("START GAME");
      await sendMessage(
        [connectionId, response.Messages[0].Body],
        "START_GAME"
      );
      await sqs
        .deleteMessage({
          QueueUrl: queueUrl,
          ReceiptHandle: response.Messages[0].ReceiptHandle,
        })
        .promise();
    } else {
      // add user to queue
      console.log("ADD USER TO QUEUE");
      await sendMessage([connectionId], "WAITING");
      await sqs
        .sendMessage({
          QueueUrl: queueUrl,
          MessageBody: connectionId,
        })
        .promise();
    }
  }

  return {};
};
