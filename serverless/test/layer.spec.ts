import {
  findLambdas,
  LambdaFunction,
  RuntimeType,
  applyLayers,
  DD_ACCOUNT_ID,
  DD_GOV_ACCOUNT_ID,
  getMissingLayerVersionErrorMsg,
} from "../src/layer";

function mockFunctionResource(runtime: string) {
  return {
    Type: "AWS::Lambda::Function",
    Properties: {
      Handler: "app.handler",
      Role: "role-arn",
      Runtime: runtime,
    },
  };
}

function mockLambdaFunction(key: string, runtime: string, runtimeType: RuntimeType) {
  return {
    properties: {
      Handler: "app.handler",
      Runtime: runtime,
      Role: "role-arn",
    },
    key,
    runtimeType,
    runtime,
  } as LambdaFunction;
}

describe("findLambdas", () => {
  it("finds lambdas and correct assigns runtime types", () => {
    const resources = {
      FunctionA: mockFunctionResource("nodejs8.10"),
      FunctionB: mockFunctionResource("nodejs10.x"),
      FunctionC: mockFunctionResource("nodejs12.x"),
      FunctionD: mockFunctionResource("nodejs14.x"),
      FunctionE: mockFunctionResource("python2.7"),
      FunctionF: mockFunctionResource("python3.6"),
      FunctionG: mockFunctionResource("python3.7"),
      FunctionH: mockFunctionResource("python3.8"),
      FunctionI: mockFunctionResource("go1.10"),
    };
    const lambdas = findLambdas(resources);

    expect(lambdas).toEqual([
      mockLambdaFunction("FunctionA", "nodejs8.10", RuntimeType.NODE),
      mockLambdaFunction("FunctionB", "nodejs10.x", RuntimeType.NODE),
      mockLambdaFunction("FunctionC", "nodejs12.x", RuntimeType.NODE),
      mockLambdaFunction("FunctionD", "nodejs14.x", RuntimeType.NODE),
      mockLambdaFunction("FunctionE", "python2.7", RuntimeType.PYTHON),
      mockLambdaFunction("FunctionF", "python3.6", RuntimeType.PYTHON),
      mockLambdaFunction("FunctionG", "python3.7", RuntimeType.PYTHON),
      mockLambdaFunction("FunctionH", "python3.8", RuntimeType.PYTHON),
      mockLambdaFunction("FunctionI", "go1.10", RuntimeType.UNSUPPORTED),
    ]);
  });
});

describe("applyLayers", () => {
  it("adds a layer array if none are present", () => {
    const lambda = mockLambdaFunction("FunctionKey", "nodejs12.x", RuntimeType.NODE);
    const region = "us-east-1";
    const nodeLayerVersion = 25;
    const errors = applyLayers(region, [lambda], undefined, nodeLayerVersion);

    expect(errors.length).toEqual(0);
    expect(lambda.properties.Layers).toEqual([
      `arn:aws:lambda:${region}:${DD_ACCOUNT_ID}:layer:Datadog-Node12-x:${nodeLayerVersion}`,
    ]);
  });

  it("appends to the layer array if already present", () => {
    const lambda = mockLambdaFunction("FunctionKey", "nodejs12.x", RuntimeType.NODE);
    lambda.properties.Layers = ["node:2"];

    const region = "us-east-1";
    const nodeLayerVersion = 25;
    const errors = applyLayers(region, [lambda], undefined, nodeLayerVersion);

    expect(errors.length).toEqual(0);
    expect(lambda.properties.Layers).toEqual([
      "node:2",
      `arn:aws:lambda:${region}:${DD_ACCOUNT_ID}:layer:Datadog-Node12-x:${nodeLayerVersion}`,
    ]);
  });

  it("doesn't add duplicate layers", () => {
    const lambda = mockLambdaFunction("FunctionKey", "nodejs12.x", RuntimeType.NODE);
    const region = "us-east-1";
    const nodeLayerVersion = 25;
    const layerArn = `arn:aws:lambda:${region}:${DD_ACCOUNT_ID}:layer:Datadog-Node12-x:${nodeLayerVersion}`;
    lambda.properties.Layers = [layerArn];
    const errors = applyLayers(region, [lambda], undefined, nodeLayerVersion);

    expect(errors.length).toEqual(0);
    expect(lambda.properties.Layers).toEqual([layerArn]);
  });

  it("only adds layer when region it is available in region", () => {
    const lambda = mockLambdaFunction("FunctionKey", "nodejs12.x", RuntimeType.NODE);
    const errors = applyLayers("unsupported-region", [lambda], 18);

    expect(errors.length).toEqual(0);
    expect(lambda.properties.Layers).toBeUndefined();
  });

  it("doesn't add layer when runtime is not supported", () => {
    const lambda = mockLambdaFunction("FunctionKey", "go1.10", RuntimeType.UNSUPPORTED);
    const errors = applyLayers("us-east-1", [lambda]);

    expect(errors.length).toEqual(0);
    expect(lambda.properties.Layers).toBeUndefined();
  });

  it("returns errors if layer versions are not provided for corresponding Lambda runtimes", () => {
    const pythonLambda = mockLambdaFunction("PythonFunctionKey", "python2.7", RuntimeType.PYTHON);
    const nodeLambda = mockLambdaFunction("NodeFunctionKey", "nodejs12.x", RuntimeType.NODE);
    const errors = applyLayers("us-east-1", [pythonLambda, nodeLambda]);

    expect(errors).toEqual([
      getMissingLayerVersionErrorMsg("PythonFunctionKey", "Python", "python"),
      getMissingLayerVersionErrorMsg("NodeFunctionKey", "Node.js", "node"),
    ]);
    expect(pythonLambda.properties.Layers).toBeUndefined();
    expect(nodeLambda.properties.Layers).toBeUndefined();
  });
});

describe("isGovCloud", () => {
  it("applies the GovCloud layer", () => {
    const pythonLambda = mockLambdaFunction("PythonFunctionKey", "python3.8", RuntimeType.PYTHON);
    const nodeLambda = mockLambdaFunction("NodeFunctionKey", "nodejs10.x", RuntimeType.NODE);
    const errors = applyLayers("us-gov-east-1", [pythonLambda, nodeLambda], 21, 30);

    expect(errors.length).toEqual(0);
    expect(pythonLambda.properties.Layers).toEqual([
      `arn:aws-us-gov:lambda:us-gov-east-1:${DD_GOV_ACCOUNT_ID}:layer:Datadog-Python38:21`,
    ]);
    expect(nodeLambda.properties.Layers).toEqual([
      `arn:aws-us-gov:lambda:us-gov-east-1:${DD_GOV_ACCOUNT_ID}:layer:Datadog-Node10-x:30`,
    ]);
  });
});
