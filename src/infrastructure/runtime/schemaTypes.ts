export type SchemaProfile = 'helper' | 'collection';
export interface SchemaIssue { instancePath: string; keyword: string; message?: string }
export interface SchemaValidator { (value: unknown): boolean; errors?: SchemaIssue[] | null }
export interface SchemaCompiler {
  compile(schema: object): SchemaValidator;
  errorsText(errors?: SchemaIssue[] | null): string;
}
