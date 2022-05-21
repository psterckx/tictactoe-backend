const aws = require("aws-sdk");
const { customAlphabet } = require("nanoid");
const nanoid = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 10);

const { wsEndpoint: endpoint, queueUrl, gameTableName } = process.env;

const client = new aws.ApiGatewayManagementApi({ endpoint });

const sqs = new aws.SQS();
const ddb = new aws.DynamoDB.DocumentClient({ region: "us-east-1" });

function sendMessage(connectionIds, payload) {
  return Promise.all(
    connectionIds.map((id) => {
      return client
        .postToConnection({
          ConnectionId: id,
          Data: Buffer.from(JSON.stringify(payload)),
        })
        .promise();
    })
  );
}

async function getConnectionFromQueue() {
  const response = await sqs
    .receiveMessage({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 2,
    })
    .promise();

  if (response.Messages) {
    return response.Messages[0];
  }
  return null;
}

async function removeConnectionFromQueue(receiptHandle) {
  await sqs
    .deleteMessage({
      QueueUrl: queueUrl,
      ReceiptHandle: receiptHandle,
    })
    .promise();
}

async function addConnectionToQueue(connectionId) {
  await sqs
    .sendMessage({
      QueueUrl: queueUrl,
      MessageBody: connectionId,
    })
    .promise();
}

async function createGame(gameId, players) {
  const game = {
    pk: `game#${gameId}`,
    sk: new Date().toISOString(),
    players: {
      player1: {
        connectionId: players.player1,
        marker: "X",
      },
      player2: {
        connectionId: players.player2,
        marker: "O",
      },
    },
    state: {
      whosTurn: "player1",
      gameOver: false,
      winner: null,
      board: [
        ["", "", ""],
        ["", "", ""],
        ["", "", ""],
      ],
    },
  };

  await ddb
    .put({
      TableName: gameTableName,
      Item: game,
    })
    .promise();

  return game;
}

// ! Assumption: users will not disconnect while they are in the queue waiting for a game

exports.handler = async (event) => {
  if (event.requestContext) {
    const connectionId = event.requestContext.connectionId;
    const routeKey = event.requestContext.routeKey;

    console.log(routeKey, connectionId);

    const message = await getConnectionFromQueue();

    if (message) {
      // start game
      console.log("START GAME");
      const gameId = nanoid();
      const player1 = connectionId; // X
      const player2 = message.Body; // O
      const [_, game] = await Promise.all([
        removeConnectionFromQueue(message.ReceiptHandle),
        createGame(gameId, { player1, player2 }),
      ]);
      await Promise.all([
        sendMessage([player1], {
          event: "START_GAME",
          gameId,
          ...game.state,
          player: "player1",
          marker: "X",
        }),
        sendMessage([player2], {
          event: "START_GAME",
          gameId,
          ...game.state,
          player: "player2",
          marker: "O",
        }),
      ])
      await sendMessage([player1], {
        event: "BEGIN_TURN",
      });
    } else {
      // add user to queue
      console.log("ADD USER TO QUEUE");
      await addConnectionToQueue(connectionId);
      await sendMessage([connectionId], "WAITING");
    }
  }

  return {};
};
