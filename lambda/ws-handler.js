const aws = require("aws-sdk");

const { wsEndpoint } = process.env;

const endpoint = wsEndpoint;
const client = new aws.ApiGatewayManagementApi({ endpoint });

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

/**
 * events to client
 * your turn
 * end game / win / loose
 *
 * actions from client
 * mark square
 *
 *
 * your turn => mark square => other players turn => mark square => ... => win / loose
 *
 */

const game = {
  pk: "gameid",
  sk: "start time",
  players: {
    player1: {
      connectionId: "connectionId",
      marker: "X",
    },
    player2: {
      connectionId: "connectionId",
      marker: "O",
    },
  },
  state: {
    whosTurn: "player",
    gameOver: false,
    winner: "player",
    board: [
      ["x", "o", "x"],
      ["o", "x", "o"],
      ["x", "o", "x"],
    ],
  },
};

async function markSquare({ gameId, connectionId, square }) {
  console.log("mark square", gameId, connectionId, square);

  if (!gameId || !connectionId || !square) {
    console.log("missing params");
    return;
  }

  // todo - update pk / sk so we can just to get item
  const response = await ddb
    .query({
      TableName: gametableName,
      Key: {
        pk: `game#${gameId}`,
      },
    })
    .promise();

  const game = response.Items[0];

  // Check that it is the players turn
  if (game.players[game.state.whosTurn].connectionId !== connectionId) {
    console.log("not your turn");
    return;
  }

  // square = [x,y]
  if (
    square.some((x) => {
      return !(x >= 0 && x <= 2);
    })
  ) {
    console.log("invalid square");
    return;
  }

  // Check that the square is empty
  if (game.state.board[square[0]][square[1]] !== "") {
    console.log("square already taken");
    return;
  }

  // Update the board
  game.state.board[square[0]][square[1]] =
    game.players[game.state.whosTurn].marker;

  // todo - Check for a win

  // Change turn turn
  game.state.whosTurn =
    game.players.whosTurn === "player1" ? "player2" : "player1";

  // update the game
  await ddb
    .update({
      TableName: gametableName,
      Key: {
        pk: game.pk,
        sk: game.sk,
      },
      UpdateExpression: "SET state.board = :board, state.whosTurn = :whosTurn",
      ExpressionAttributeValues: {
        ":board": game.state.board,
        ":whosTurn": game.state.whosTurn,
      },
    })
    .promise();

  // Send updated game state to clients
  await sendMessage(
    [game.players.player1.connectionId, game.players.player2.connectionId],
    game.state
  );

  // Send begin turn message to next player
  await sendMessage([game.players[game.state.whosTurn].connectionId], {
    event: "BEGIN_TURN",
  });
}

// from client
const actions = {
  $connect: () => console.log("CONNECT"),
  $disconnect: () => console.log("DISCONNECT"),
  markSquare: (connectionId, data) => markSquare({ connectionId, ...data }),
};

// to client
const events = {
  BEGIN_TURN: "BEGIN_TURN",
  WIN: "WIN",
  LOSE: "LOSE",
};

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

    if (events[routeKey]) {
      events[routeKey](connectionId, body);
    }
  }

  return {};
};
