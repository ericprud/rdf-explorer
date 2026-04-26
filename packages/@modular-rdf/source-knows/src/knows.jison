%{
interface Loc {
  first_line:   number
  last_line:    number
  first_column: number
  last_column:  number
}

export class KnowsParserState {
  readonly people   = new Map<string, number>()
  readonly knowses  = new Map<string, [string, number][]>()
  readonly warnings: string[] = []

  static cap (s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1)
  }

  addPerson (name: string, loc: Loc): void {
    if (!this.people.has(name)) this.people.set(name, loc.first_line)
  }

  addKnows (subj: string, obj: string, loc: Loc): void {
    const list = this.knowses.get(subj)
    if (list) {
      list.push([obj, loc.first_line])
    } else {
      this.knowses.set(subj, [[obj, loc.first_line]])
    }
  }

  addWarning (msg: string): void {
    this.warnings.push(msg)
  }

  result (): { people: Map<string, number>; knowses: Map<string, [string, number][]>; warnings: string[] } {
    return { people: this.people, knowses: this.knowses, warnings: this.warnings }
  }
}
%}

%lex
IT_KNOWS  [Kk][Nn][Oo][Ww][Ss]
COMMENT   '#' [^\n]*

%no-break-if  (.*[^a-z] | '') 'return' ([^a-z].* | '')

%%

\s+|{COMMENT}   /* skip */
{IT_KNOWS}      return 'IT_KNOWS';
[A-Za-z][A-Za-z0-9_-]*  return 'NAME';
"."             return '.';
<<EOF>>         return 'EOF';
.               { return 'invalid:'+yytext; }

/lex

%start document

%%

document
  : stmts EOF  { return (yy as KnowsParserState).result(); }
  ;

stmts
  :
  | stmts stmt
  ;

stmt
  : NAME IT_KNOWS NAME dot_Opt {
      const state = yy as KnowsParserState
      const subj = KnowsParserState.cap($1)
      const obj  = KnowsParserState.cap($3)
      state.addPerson(subj, @1)
      state.addPerson(obj,  @3)
      state.addKnows(subj, obj, @1)
    }
  ;

dot_Opt
  :
  | '.'
  ;
