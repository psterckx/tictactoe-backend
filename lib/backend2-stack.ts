import {
  Stack,
  StackProps,
  aws_lambda as lambda,
  aws_iam as iam,
} from "aws-cdk-lib";
import { WebSocketLambdaIntegration } from "@aws-cdk/aws-apigatewayv2-integrations-alpha";
import { WebSocketApi, WebSocketStage } from "@aws-cdk/aws-apigatewayv2-alpha";
import { Construct } from "constructs";

export class Backend2Stack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const wsHanlderRole = new iam.Role(this, "WSHandlerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });

    const wsHandler = new lambda.Function(this, "WSHandler", {
      runtime: lambda.Runtime.NODEJS_14_X,
      code: lambda.Code.fromAsset("lambda"),
      handler: "ws-handler.handler",
      role: wsHanlderRole,
    });

    wsHanlderRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AWSLambdaBasicExecutionRole"
      )
    );
    wsHanlderRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "AmazonAPIGatewayInvokeFullAccess"
      )
    );

    const webSocketApi = new WebSocketApi(this, "mywsapi", {
      connectRouteOptions: {
        integration: new WebSocketLambdaIntegration(
          "ConnectIntegration",
          wsHandler
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

    const webSocketStage = new WebSocketStage(this, "mywsstage", {
      webSocketApi,
      stageName: "dev",
      autoDeploy: true,
    });
  }
}
