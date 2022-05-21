const aws = require("aws-sdk");

const { wsEndpoint, gameTableName } = process.env;

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

// const game = {
//   pk: "gameid",
//   sk: "start time",
//   players: {
//     player1: {
//       connectionId: "connectionId",
//       marker: "X",
//     },
//     player2: {
//       connectionId: "connectionId",
//       marker: "O",
//     },
//   },
//   state: {
//     whosTurn: "player",
//     gameOver: false,
//     winner: "player",
//     board: [
//       ["x", "o", "x"],
//       ["o", "x", "o"],
//       ["x", "o", "x"],
//     ],
//   },
// };

function checkForWin(marker, board = []) {
  const winConditions = [
    [
      [0, 0],
      [0, 1],
      [0, 2],
    ],
    [
      [1, 0],
      [1, 1],
      [1, 2],
    ],
    [
      [2, 0],
      [2, 1],
      [2, 2],
    ],
    [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
    [
      [0, 1],
      [1, 1],
      [2, 1],
    ],
    [
      [0, 2],
      [1, 2],
      [2, 2],
    ],
    [
      [0, 0],
      [1, 1],
      [2, 2],
    ],
    [
      [0, 2],
      [1, 1],
      [2, 0],
    ],
  ];

  return winConditions.some((condition) => {
    return condition.every(([x, y]) => {
      return board[x][y] === marker;
    });
  });
}

async function updateGameBoardandWhosTurn(pk, sk, board, whosTurn) {
  await ddb
    .update({
      TableName: gameTableName,
      Key: {
        pk,
        sk,
      },
      UpdateExpression:
        "SET #state.#board = :board, #state.#whosTurn = :whosTurn",
      ExpressionAttributeNames: {
        "#state": "state",
        "#board": "board",
        "#whosTurn": "whosTurn",
      },
      ExpressionAttributeValues: {
        ":board": board,
        ":whosTurn": whosTurn,
      },
    })
    .promise();
}

async function updateGameWinner(pk, sk, winner) {
  await ddb
    .update({
      TableName: gameTableName,
      Key: {
        pk,
        sk,
      },
      UpdateExpression:
        "SET #state.#winner = :winner, #state.#gameOver = :gameOver",
      ExpressionAttributeNames: {
        "#state": "state",
        "#winner": "winner",
        "#gameOver": "gameOver",
      },
      ExpressionAttributeValues: {
        ":winner": winner,
        ":gameOver": true,
      },
    })
    .promise();
}

async function markSquare({ gameId, connectionId, square }) {
  console.log("mark square", gameId, connectionId, square);
  console.log("testing");

  if (!gameId || !connectionId || !square) {
    console.log("missing params");
    return;
  }

  // todo - update pk / sk so we can just to get item
  console.log("get game from ddb");
  const response = await ddb
    .query({
      TableName: gameTableName,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: {
        ":pk": `game#${gameId}`,
      },
    })
    .promise();

  if (response.Items.length === 0) {
    console.log("Game not found");
    await sendMessage([connectionId], { message: "Game not found." });
    return;
  }

  const game = response.Items[0];
  console.log("game", game);

  if (game.state.gameOver) {
    console.log("Game has ended.");
    await sendMessage([connectionId], { message: "This game has ended." });
    return;
  }

  // Check that it is the players turn
  if (game.players[game.state.whosTurn].connectionId !== connectionId) {
    console.log("Not your turn.");
    await sendMessage([connectionId], { message: "Not your turn." });
    return;
  }

  // square = [x,y]
  if (
    square.some((x) => {
      return !(x >= 0 && x <= 2);
    })
  ) {
    await sendMessage([connectionId], { message: "Invalid square." });
    return;
  }

  // Check that the square is empty
  if (game.state.board[square[0]][square[1]] !== "") {
    await sendMessage([connectionId], {
      message: "Square already taken. Please try again.",
    });
    console.log("Square already taken.");
    return;
  }

  // Update the board
  console.log("Update board.");
  game.state.board[square[0]][square[1]] =
    game.players[game.state.whosTurn].marker;

  // todo - Check for a win
  if (checkForWin(game.players[game.state.whosTurn].marker, game.state.board)) {
    game.state.gameOver = true;
    game.state.winner = game.state.whosTurn;
    await sendMessage([connectionId], {
      event: "WIN",
      ...game.state,
    });
    const loser =
      game.players[game.state.whosTurn === "player1" ? "player2" : "player1"];
    await sendMessage([loser.connectionId], {
      event: "LOSE",
      ...game.state,
    });
    await updateGameWinner(game.pk, game.sk, game.state.winner);
    return;
  }

  // Change turn turn
  console.log("Change turn.");
  game.state.whosTurn =
    game.state.whosTurn === "player1" ? "player2" : "player1";

  // update the game
  console.log("Update game in ddb.");
  await updateGameBoardandWhosTurn(
    game.pk,
    game.sk,
    game.state.board,
    game.state.whosTurn
  );

  // Send updated game state to clients
  console.log("Send updated game state to clients.");
  await sendMessage(
    [game.players.player1.connectionId, game.players.player2.connectionId],
    { event: "GAME_UPDATED", ...game.state }
  );

  // Send begin turn message to next player
  console.log("Send begin turn message to next player.");
  await sendMessage([game.players[game.state.whosTurn].connectionId], {
    event: "BEGIN_TURN",
  });
}

// from client
const actions = {
  $connect: () => console.log("CONNECT"),
  $disconnect: () => console.log("DISCONNECT"),
  markSquare: async (connectionId, data) =>
    await markSquare({ connectionId, ...data }),
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
      return;
    }

    if (actions[routeKey]) {
      await actions[routeKey](connectionId, body);
    } else {
      console.log(`No event handler for ${routeKey}`);
    }
  }

  return {};
};
