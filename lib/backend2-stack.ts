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

    const matcherSqsPolicy = new iam.PolicyDocument({
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
    });

    const matcherRole = new iam.Role(this, "matcherRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        SqsReadWrite: matcherSqsPolicy,
      },
    });

    matcherRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AWSLambdaBasicExecutionRole"
      )
    );

    const wsHandler = new lambda.Function(this, "WSHandler", {
      runtime: lambda.Runtime.NODEJS_14_X,
      code: lambda.Code.fromAsset("lambda"),
      handler: "ws-handler.handler",
      role: wsHandlerRole,
    });

    const matcher = new lambda.Function(this, "matcher", {
      runtime: lambda.Runtime.NODEJS_14_X,
      code: lambda.Code.fromAsset("lambda"),
      handler: "matcher.handler",
      role: matcherRole,
    });

    const webSocketApi = new WebSocketApi(this, "tictactoe-websocket-api", {
      connectRouteOptions: {
        integration: new WebSocketLambdaIntegration(
          "ConnectIntegration",
          matcher
        ),
      },
      disconnectRouteOptions: {
        integration: new WebSocketLambdaIntegration(
          "DisconnectIntegration",
          wsHandler
        ),
      },
      defaultRouteOptions: {
        integration: new WebSocketLambdaIntegration(
          "DefaultIntegration",
          wsHandler
        ),
      },
    });

    webSocketApi.addRoute("broadcastMessage", {
      integration: new WebSocketLambdaIntegration(
        "BroadcastMessageIntegration",
        wsHandler
      ),
    });

    const webSocketStage = new WebSocketStage(this, "dev-stage", {
      webSocketApi,
      stageName: "dev",
      autoDeploy: true,
    });

    // const gameTable = new dynamodb.Table(this, "game-table", {
    //   tableName: "game-table",
    //   billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    //   partitionKey: {
    //     name: "pk",
    //     type: dynamodb.AttributeType.STRING,
    //   },
    //   sortKey: {
    //     name: "sk",
    //     type: dynamodb.AttributeType.STRING,
    //   },
    // });
  }
}
