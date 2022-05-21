const aws = require("aws-sdk");

const endpoint = "https://45tiumvni1.execute-api.us-east-1.amazonaws.com/dev";
const client = new aws.ApiGatewayManagementApi({ endpoint });

const sqs = new aws.SQS();

function sendMessage(connectionIds, event) {
  return Promise.all(
    connectionIds.map((id) => {
      return client.postToConnection({
        ConnectionId: id,
        Data: Buffer.from(JSON.stringify({ event })),
      });
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
        QueueUrl:
          "https://sqs.us-east-1.amazonaws.com/878228692056/demo-game-matching-queue-2",
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
          QueueUrl:
            "https://sqs.us-east-1.amazonaws.com/878228692056/demo-game-matching-queue-2",
          ReceiptHandle: response.Messages[0].ReceiptHandle,
        })
        .promise();
    } else {
      // add user to queue
      console.log("ADD USER TO QUEUE");
      await sendMessage([connectionId], "WAITING");
      await sqs
        .sendMessage({
          QueueUrl:
            "https://sqs.us-east-1.amazonaws.com/878228692056/demo-game-matching-queue-2",
          MessageBody: connectionId,
        })
        .promise();
    }
  }

  return {};
};
