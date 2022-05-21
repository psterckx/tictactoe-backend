import {
  Stack,
  StackProps,
  aws_lambda as lambda,
  aws_iam as iam,
  aws_dynamodb as dynamodb,
  aws_sqs as sqs,
  Duration,
} from "aws-cdk-lib";
import { WebSocketLambdaIntegration } from "@aws-cdk/aws-apigatewayv2-integrations-alpha";
import { WebSocketApi, WebSocketStage } from "@aws-cdk/aws-apigatewayv2-alpha";
import { Construct } from "constructs";

export class Backend2Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const dbbGameTableName = "tictactoe-table";

    // Matching Queue
    const matcherQueue = new sqs.Queue(this, "tictactoe-matcher-queue", {
      queueName: "tictactoe-matcher-queue",
      visibilityTimeout: Duration.seconds(20),
      receiveMessageWaitTime: Duration.seconds(20),
      retentionPeriod: Duration.hours(1),
    });

    matcherQueue.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.AccountPrincipal(this.account)],
        resources: [matcherQueue.queueArn],
        actions: ["SQS:*"],
      })
    );

    // WS Handler Role
    const wsHandlerRole = new iam.Role(this, "WSHandlerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });

    wsHandlerRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AWSLambdaBasicExecutionRole"
      )
    );

    wsHandlerRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "AmazonAPIGatewayInvokeFullAccess"
      )
    );

    // Matcher Role
    const matcherRole = new iam.Role(this, "matcherRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        SqsReadWrite: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              resources: ["*"],
              actions: [
                "sqs:DeleteMessage",
                "sqs:ReceiveMessage",
                "sqs:SendMessage",
                "sqs:GetQueueAttributes",
              ],
              effect: iam.Effect.ALLOW,
            }),
          ],
        }),
      },
    });

    matcherRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AWSLambdaBasicExecutionRole"
      )
    );

    matcherRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "AmazonAPIGatewayInvokeFullAccess"
      )
    );

    // Web Socket API
    const webSocketApi = new WebSocketApi(this, "tictactoe-websocket-api", {});

    const webSocketStage = new WebSocketStage(this, "dev-stage", {
      webSocketApi,
      stageName: "dev",
      autoDeploy: true,
    });

    // Web Socket Game Handler
    const wsHandler = new lambda.Function(this, "WSHandler", {
      functionName: "tictactoe-ws-handler",
      runtime: lambda.Runtime.NODEJS_14_X,
      code: lambda.Code.fromAsset("lambda", { exclude: [".zip"] }),
      handler: "ws-handler.handler",
      role: wsHandlerRole,
      timeout: Duration.seconds(10),
      environment: {
        wsEndpoint: webSocketStage.callbackUrl,
        gameTableName: dbbGameTableName,
      },
    });

    // Web Socket Match (handles the "requestGame" event)
    const matcher = new lambda.Function(this, "matcher", {
      functionName: "tictactoe-matcher",
      runtime: lambda.Runtime.NODEJS_14_X,
      code: lambda.Code.fromAsset("lambda", { exclude: [".zip"] }),
      handler: "matcher.handler",
      role: matcherRole,
      timeout: Duration.seconds(10),
      environment: {
        wsEndpoint: webSocketStage.callbackUrl,
        queueUrl: matcherQueue.queueUrl,
        gameTableName: dbbGameTableName,
      },
    });

    // Add routes to Web Socket API

    webSocketApi.addRoute("$connect", {
      integration: new WebSocketLambdaIntegration(
        "ConnectIntegration",
        wsHandler
      ),
    });
    webSocketApi.addRoute("$disconnect", {
      integration: new WebSocketLambdaIntegration(
        "DisconnectIntegration",
        wsHandler
      ),
    });
    webSocketApi.addRoute("$default", {
      integration: new WebSocketLambdaIntegration(
        "DefaultIntegration",
        wsHandler
      ),
    });

    webSocketApi.addRoute("requestGame", {
      integration: new WebSocketLambdaIntegration(
        "RequestGameIntegration",
        matcher
      ),
    });

    webSocketApi.addRoute("markSquare", {
      integration: new WebSocketLambdaIntegration(
        "MarkSquareIntegration",
        wsHandler
      ),
    });

    const gameTable = new dynamodb.Table(this, "game-table", {
      tableName: dbbGameTableName,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: "pk",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "sk",
        type: dynamodb.AttributeType.STRING,
      },
    });

    gameTable.grantReadWriteData(matcher);
    gameTable.grantReadWriteData(wsHandler);
  }
}
