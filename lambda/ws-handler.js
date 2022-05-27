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

function checkForDraw(board) {
  return board.every((row) => {
    return row.every((square) => {
      return square !== "";
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

  if (checkForWin(game.players[game.state.whosTurn].marker, game.state.board)) {
    game.state.gameOver = true;
    game.state.winner = game.state.whosTurn;
    await updateGameWinner(game.pk, game.sk, game.state.winner);
    await sendMessage([connectionId], {
      event: "WIN",
      state: game.state,
    });
    const loser =
      game.players[game.state.whosTurn === "player1" ? "player2" : "player1"];
    await sendMessage([loser.connectionId], {
      event: "LOSE",
      state: game.state,
    });
    return;
  }

  if (checkForDraw(game.state.board)) {
    game.state.gameOver = true;
    game.state.winner = "draw";
    await updateGameWinner(game.pk, game.sk, "draw");
    await sendMessage(
      [game.players.player1.connectionId, game.players.player2.connectionId],
      {
        event: "DRAW",
        state: game.state,
      }
    );
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
    { event: "GAME_UPDATED", state: game.state }
  );

  // Send begin turn message to next player
  console.log("Send begin turn message to next player.");
  await sendMessage([game.players[game.state.whosTurn].connectionId], {
    event: "BEGIN_TURN",
  });
}

async function onConnect(connectionId) {
  await ddb
    .put({
      TableName: gameTableName,
      Item: {
        pk: `connection#${connectionId}`,
        sk: "sk",
        connected: new Date().toISOString(),
      },
      ConditionExpression: "attribute_not_exists(pk)",
    })
    .promise();

  const {
    Attributes: { n },
  } = await ddb
    .update({
      TableName: gameTableName,
      Key: {
        pk: "connections",
        sk: "sk",
      },
      UpdateExpression: "SET #n = if_not_exists(#n, :start) + :increment",
      ExpressionAttributeNames: {
        "#n": "n",
      },
      ExpressionAttributeValues: {
        ":increment": 1,
        ":start": 0,
      },
      ReturnValues: "UPDATED_NEW",
    })
    .promise();
}

async function onDisconnect(connectionId) {
  // Check if connection has an active game
  const response = await ddb
    .get({
      TableName: gameTableName,
      Key: { pk: `connection#${connectionId}`, sk: "sk" },
      AttributesToGet: ["gameId"],
    })
    .promise();

  if (response.Item) {
    if (response.Item.gameId) {
      // Get the game
      const gameResponse = await ddb
        .query({
          TableName: gameTableName,
          KeyConditionExpression: "pk = :pk",
          ExpressionAttributeValues: {
            ":pk": `game#${response.Item.gameId}`,
          },
          ProjectionExpression: "players, sk, #state",
          ExpressionAttributeNames: {
            "#state": "state",
          },
        })
        .promise();

      // Send disconnect message to other player
      const { players, sk, state } = gameResponse.Items[0];

      if (!state.gameOver) {
        // player that disconnected
        const disconnectedPlayer =
          players.player1.connectionId === connectionId ? "player1" : "player2";
        const otherPlayer =
          disconnectedPlayer === "player1" ? "player2" : "player1";

        // Update the game state
        state.gameOver = true;
        state.winner = otherPlayer;

        await sendMessage([players[otherPlayer].connectionId], {
          event: "OPPONENT_DISCONNECTED",
          state,
        });

        // End the game
        await ddb
          .update({
            TableName: gameTableName,
            Key: {
              pk: `game#${response.Item.gameId}`,
              sk,
            },
            UpdateExpression:
              "SET #state.#gameOver = :gameOver, #state.#winner = :winner",
            ExpressionAttributeNames: {
              "#state": "state",
              "#gameOver": "gameOver",
              "#winner": "winner",
            },
            ExpressionAttributeValues: {
              ":gameOver": true,
              ":winner": otherPlayer,
            },
          })
          .promise();
      }
    }
  }

  await ddb
    .update({
      TableName: gameTableName,
      Key: {
        pk: "connections",
        sk: "sk",
      },
      UpdateExpression: "SET #n = if_not_exists(#n, :start) - :decrement",
      ExpressionAttributeNames: {
        "#n": "n",
      },
      ExpressionAttributeValues: {
        ":decrement": 1,
        ":start": 0,
      },
      ReturnValues: "UPDATED_NEW",
    })
    .promise();

  await ddb
    .delete({
      TableName: gameTableName,
      Key: {
        pk: `connection#${connectionId}`,
        sk: "sk",
      },
    })
    .promise();

  console.log("CONNECTION DELETED");
}

// from client
const actions = {
  $connect: (connectionId, _) => onConnect(connectionId),
  $disconnect: (connectionId, _) => onDisconnect(connectionId),
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
