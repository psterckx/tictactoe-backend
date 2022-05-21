const aws = require("aws-sdk");

const { wsEndpoint } = process.env

const endpoint = wsEndpoint;
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
        // if (users.length > 0) {
        //   await broadcastMessage(users, {
        //     systemMessage: "Someone has joined the chat.",
        //   });
        // }
        // users.push(connectionId);
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
