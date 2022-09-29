import ts, { factory } from "typescript";
import { DocumentNode } from "graphql";
import { ASTReducer, visit } from "./typedVisitor";
import { TsCodegenContext } from "./context";
import {
  createNullableType,
  createNonNullableType,
  isDirectAncestorInput,
  addModelSuffix,
} from "./utilities";

export function generateModels(
  context: TsCodegenContext,
  document: DocumentNode,
): ts.SourceFile {
  return visit(document, createModelsReducer(context)) as ts.SourceFile;
}

type ASTReducerMap = {
  Document: ts.SourceFile;
  SchemaExtension: null;
  ObjectTypeExtension: null;

  NameNode: string;

  NamedType: ts.TypeNode | ts.Expression;
  ListType: ts.TypeNode;
  NonNullType: ts.TypeNode;

  Directive: null;

  FieldDefinition: ts.PropertySignature;
  InputValueDefinition: null;

  ObjectTypeDefinition: ts.InterfaceDeclaration | null;
  InputObjectTypeDefinition: null;
  UnionTypeDefinition: ts.TypeAliasDeclaration;
  EnumTypeDefinition: ts.EnumDeclaration;
  EnumValueDefinition: ts.EnumMember;
  InterfaceTypeDefinition: ts.InterfaceDeclaration;
  ScalarTypeDefinition: null;

  DirectiveDefinition: null;
};

type ASTReducerFieldMap = {
  Document: {
    definitions: ts.Statement | ts.Statement[];
  };

  NamedType: {
    name: ASTReducerMap["NameNode"];
  };
  ListType: {
    type: ts.TypeNode;
  };
  NonNullType: {
    type: ts.TypeNode;
  };

  FieldDefinition: {
    name: ASTReducerMap["NameNode"];
    type: ts.TypeNode;
  };

  ObjectTypeDefinition: {
    name: ASTReducerMap["NameNode"];
    interfaces: ASTReducerMap["NamedType"];
    fields: ASTReducerMap["FieldDefinition"];
  };

  UnionTypeDefinition: {
    name: ASTReducerMap["NameNode"];
    types: ts.TypeNode;
  };
  InterfaceTypeDefinition: {
    name: ASTReducerMap["NameNode"];
  };
  EnumTypeDefinition: {
    name: ASTReducerMap["NameNode"];
    values: ASTReducerMap["EnumValueDefinition"];
  };
  EnumValueDefinition: {
    name: ASTReducerMap["NameNode"];
  };
  ScalarTypeDefinition: {
    name: null;
  };
};

function createModelsReducer(
  context: TsCodegenContext,
): ASTReducer<ts.Node | string, ASTReducerMap, ASTReducerFieldMap> {
  return {
    Document: {
      leave(node) {
        const imports = context.getAllModelImportDeclarations() as ts.Statement[];
        const statements = node.definitions;

        return factory.createSourceFile(
          imports.concat(context.getDefaultTypes(), statements.flat()),
          factory.createToken(ts.SyntaxKind.EndOfFileToken),
          ts.NodeFlags.None,
        );
      },
    },
    SchemaExtension: {
      leave(): null {
        return null;
      },
    },
    ObjectTypeExtension: {
      leave(): null {
        return null;
      },
    },

    FieldDefinition: {
      leave(node): ts.PropertySignature {
        return factory.createPropertySignature(
          undefined,
          factory.createIdentifier(node.name),
          undefined,
          node.type,
        );
      },
    },

    ObjectTypeDefinition: {
      leave(node): ts.InterfaceDeclaration | null {
        const model = context.getDefinedModelType(node.name);
        const interfaces = (node.interfaces as ts.Expression[]) || [];
        const extendTypes = [context.getBaseModelType()];
        if (model) {
          extendTypes.push(model);
        }

        if (["Query", "Mutation", "Subscription"].includes(node.name)) {
          return null;
        }

        return factory.createInterfaceDeclaration(
          undefined,
          [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
          factory.createIdentifier(addModelSuffix(node.name)),
          undefined,
          [
            factory.createHeritageClause(ts.SyntaxKind.ExtendsKeyword, [
              ...extendTypes.map((type) =>
                factory.createExpressionWithTypeArguments(
                  type.toExpression(),
                  undefined,
                ),
              ),
              ...interfaces.map((interfaceExpression) =>
                factory.createExpressionWithTypeArguments(
                  interfaceExpression,
                  undefined,
                ),
              ),
            ]),
          ],
          [
            factory.createPropertySignature(
              undefined,
              "__typename",
              undefined,
              factory.createLiteralTypeNode(
                factory.createStringLiteral(node.name),
              ),
            ),
            ...((!model && node.fields) || []),
          ],
        );
      },
    },
    InputObjectTypeDefinition: {
      leave(node) {
        return null;
      },
    },
    InputValueDefinition: {
      leave(node) {
        return null;
      },
    },
    EnumTypeDefinition: {
      leave(node): ts.EnumDeclaration {
        return factory.createEnumDeclaration(
          undefined,
          [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
          addModelSuffix(node.name),
          node.values || [],
        );
      },
    },

    EnumValueDefinition: {
      leave(node): ts.EnumMember {
        return factory.createEnumMember(
          node.name,
          factory.createStringLiteral(node.name),
        );
      },
    },
    InterfaceTypeDefinition: {
      leave(node): ts.InterfaceDeclaration {
        const extendTypes = [context.getBaseModelType()];
        return factory.createInterfaceDeclaration(
          undefined,
          [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
          factory.createIdentifier(addModelSuffix(node.name)),
          undefined,
          [
            factory.createHeritageClause(
              ts.SyntaxKind.ExtendsKeyword,
              extendTypes.map((type) =>
                factory.createExpressionWithTypeArguments(
                  type.toExpression(),
                  undefined,
                ),
              ),
            ),
          ],
          [
            factory.createPropertySignature(
              undefined,
              "__typename",
              undefined,
              factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
            ),
          ],
        );
      },
    },
    UnionTypeDefinition: {
      leave({ name, types }): ts.TypeAliasDeclaration {
        return factory.createTypeAliasDeclaration(
          undefined,
          [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
          factory.createIdentifier(addModelSuffix(name)),
          undefined,
          factory.createUnionTypeNode(
            types?.map((type) => {
              return createNonNullableType(type as ts.UnionTypeNode);
            }) || [],
          ),
        );
      },
    },
    ScalarTypeDefinition: {
      leave(node): null {
        context.addScalar(node.name);
        return null;
      },
    },
    NamedType: {
      leave(node, _a, _p, path, ancestors): ts.TypeNode | ts.Expression {
        const isAncestorInput = isDirectAncestorInput(ancestors);

        const isImplementedInterface = path[path.length - 2] === "interfaces";
        if (isImplementedInterface) {
          return factory.createIdentifier(addModelSuffix(node.name));
        }

        return createNullableType(
          context.getModelType(node.name, !isAncestorInput).toTypeReference(),
        );
      },
    },
    ListType: {
      leave({ type }): ts.TypeNode {
        return createNullableType(
          factory.createArrayTypeNode(type as ts.TypeNode),
        );
      },
    },
    NonNullType: {
      leave({ type }): ts.TypeNode {
        return createNonNullableType(type as ts.UnionTypeNode);
      },
    },

    Name: {
      leave(node) {
        return node.value;
      },
    },

    DirectiveDefinition: {
      leave() {
        return null;
      },
    },

    Directive: {
      leave() {
        return null;
      },
    },
  };
}