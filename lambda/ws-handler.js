const aws = require("aws-sdk");

const endpoint = "https://45tiumvni1.execute-api.us-east-1.amazonaws.com/dev";
const client = new aws.ApiGatewayManagementApi({ endpoint });

const users = [];

const sqs = new aws.SQS();

async function broadcastMessage(ids, body) {
  await Promise.all(
    ids.map((id) => {
      return client
        .postToConnection({
          ConnectionId: id,
          Data: Buffer.from(JSON.stringify(body)),
        })
        .promise();
    })
  );
}

exports.handler = async (event) => {
  const messages = await sqs
    .receiveMessage({
      QueueUrl:
        "https://sqs.us-east-1.amazonaws.com/878228692056/demo-game-matching-queue-2",
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 2,
    })
    .promise();

  await sqs
    .sendMessage({
      QueueUrl:
        "https://sqs.us-east-1.amazonaws.com/878228692056/demo-game-matching-queue-2",
      MessageBody: `user${Math.floor(Math.random() * 1000)}`,
    })
    .promise();

  await sqs.deleteMessage({
    QueueUrl: "https://sqs.us-east-1.amazonaws.com/878228692056/demo-game-matching-queue-2",
    ReceiptHandle: "",
  }).promise();

  if (event.requestContext) {
    const connectionId = event.requestContext.connectionId;
    const routeKey = event.requestContext.routeKey;

    console.log(connectionId, routeKey);

    let body;
    try {
      if (event.body) {
        body = JSON.parse(event.body);
        console.log(body);
      }
    } catch (err) {
      console.log(err);
    }

    switch (routeKey) {
      case "$connect":
        console.log("CONNECT");
        if (users.length > 0) {
          await broadcastMessage(users, {
            systemMessage: "Someone has joined the chat.",
          });
        }
        users.push(connectionId);
        break;
      case "$disconnect":
        await broadcastMessage(users, {
          systemMessage: "Someone has left the chat.",
        });
        users.filter((id) => id !== connectionId);
        break;
      case "$default":
        break;
      case "broadcastMessage":
        console.log("broadcastMessage");
        await broadcastMessage(users, { publicMessage: body.message });
      default:
        break;
    }
  }

  return {};
};
