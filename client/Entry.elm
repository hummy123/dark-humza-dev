module Entry exposing (..)

-- builtins
import Task
-- import Result exposing (Result)
-- import Set

-- lib
import Dom
-- import Result.Extra as RE
-- import Maybe.Extra as ME
-- import List.Extra as LE

-- dark
-- import Util
import Defaults
import Types exposing (..)
-- import Autocomplete
import Viewport
-- import EntryParser exposing (AST(..), ACreating(..), AExpr(..), AFillParam(..), AFillResult(..), ARef(..))
import Util
import AST
import Toplevel as TL
import Runtime as RT
import Analysis


createFindSpace : Model -> Modification
createFindSpace m = Enter (Creating (Viewport.toAbsolute m Defaults.initialPos))

---------------------
-- Focus
---------------------

focusEntry : Cmd Msg
focusEntry = Dom.focus Defaults.entryID |> Task.attempt FocusEntry


tlid : () -> TLID
tlid unit = TLID (Util.random unit)

emptyHS : () -> HandlerSpec
emptyHS _ = { name = Empty (gid ())
            , module_ = Empty (gid ())
            , modifier = Empty (gid ())
            }

createFunction : Model -> FnName -> Bool -> Maybe Expr
createFunction m name hasImplicitParam =
  let holeModifier = if hasImplicitParam then -1 else 0
      holes count = List.map (\_ -> Hole (gid ())) (List.range 1 count)
      fn = m.complete.functions
           |> List.filter (\fn -> fn.name == name)
           |> List.head
  in
    case fn of
      Just function ->
        Just <|
          FnCall
            (gid ())
            name
            (holes ((List.length function.parameters) + holeModifier))
      Nothing -> Nothing

type ThreadAction = StartThread | ContinueThread
submit : Model -> EntryCursor -> ThreadAction -> String -> Modification
submit m cursor action value =
  let
      parseAst str hasImplicit =
        let eid = gid ()
            hid1 = gid ()
            hid2 = gid ()
            hid3 = gid ()
            firstWord = String.split " " str in
        case firstWord of
          ["if"] ->
            Just (If eid (Hole hid1) (Hole hid2) (Hole hid3))
          ["let"] ->
            Just (Let eid (Empty hid1) (Hole hid2) (Hole hid3))
          ["lambda"] ->
            Just (Lambda eid ["var"] (Hole hid1))
          [""] ->
            Just (Hole eid)
          _ ->
            if RT.tipeOf str == TIncomplete || AST.isInfix str
            then createFunction m value hasImplicit
            else Just <| Value eid str

  in
  case cursor of
    Creating pos ->
      let id = tlid ()
          wrap op = RPC ([op], FocusNext id Nothing)
          threadIt expr =
            case action of
              ContinueThread ->
                expr
              StartThread ->
                let hid = gid ()
                in Thread (gid ()) [expr, Hole hid]
      in

      -- DB creation
      if String.startsWith "DB" value
      then
        let dbName = value
                     |> String.dropLeft 2
                     |> String.trim
        in wrap <| CreateDB id pos dbName

      -- field access
      else if String.startsWith "." value
      then
        let access = FieldAccess (gid ())
                                 (Variable (gid ()) (String.dropLeft 1 value))
                                 (Empty (gid ()))
            ast = threadIt access
            handler = { ast = ast, spec = emptyHS () }
        in wrap <| SetHandler id pos handler

      -- start new AST
      else
        case parseAst value (action == ContinueThread) of
          Nothing -> NoChange
          Just v ->
            let ast = threadIt v
                handler = { ast = ast, spec = emptyHS () }
            in RPC ([SetHandler id pos handler], FocusNext id Nothing)

    Filling tlid id ->
      let tl = TL.getTL m tlid
          predecessor = TL.getPrevHole tl id
          wrap op = RPC ([op], FocusNext tlid predecessor)

          replaceExpr m h tlid id value =
            let newExpr =
                  -- assign thread to variable
                  if String.startsWith "= " value
                  then
                    case AST.threadAncestors id h.ast |> List.reverse of
                      -- turn the current thread into a let-assignment to this
                      -- name, and close the thread
                      (Thread tid _ as thread) :: _ ->
                        let bindName = value
                                       |> String.dropLeft 2
                                       |> String.trim
                        in
                          Let (gid ())
                            (Full (gid ()) bindName)
                            (AST.closeThread thread)
                            (Hole (gid ()))
                      _ -> oldExpr

                  -- field access
                  else if String.startsWith "." value
                  then
                    FieldAccess
                      (gid ())
                      (Variable (gid ()) (String.dropLeft 1 value))
                      (Empty (gid ()))

                  -- variables and parsed expressions
                  else
                    let availableVars = Analysis.getAvailableVarnames m tlid id
                        holeReplacement =
                          if List.member value availableVars
                          then
                            Just (Variable (gid ()) value)
                          else
                            parseAst
                              value
                              (action == ContinueThread && TL.isThreadHole h id)
                    in
                    case holeReplacement of
                      Nothing ->
                        oldExpr
                      Just v ->
                        v

                oldExpr = AST.subtree id h.ast
                ast1 = case action of
                  ContinueThread -> h.ast
                  StartThread ->
                    AST.wrapInThread id h.ast

                ast2 = AST.maybeExtendThreadAt id ast1
                replacement = AST.replaceExpr id newExpr ast2
            in
                if oldExpr == newExpr
                then NoChange
                else wrap <| SetHandler tlid tl.pos { h | ast = replacement }

      in
      if String.length value < 1
      then NoChange
      else
      case TL.holeType tl id of
        DBColTypeHole _ ->
          wrap <| SetDBColType tlid id value
        DBColNameHole _ ->
          wrap <| SetDBColName tlid id value
        BindHole h ->
          let replacement = AST.replaceBindHole id value h.ast in
          wrap <| SetHandler tlid tl.pos { h | ast = replacement }
        SpecHole h ->
          let replacement = TL.replaceSpecHole id value h.spec in
          wrap <| SetHandler tlid tl.pos { h | spec = replacement }
        FieldHole h ->
          let replacement = AST.replaceFieldHole id value h.ast
              withNewParent = case action of
                ContinueThread -> replacement
                StartThread ->
                  let parent = AST.parentOf id replacement in
                  AST.wrapInThread (AST.toID parent) replacement
          in
          wrap <| SetHandler tlid tl.pos { h | ast = withNewParent }
        ExprHole h ->
          replaceExpr m h tlid id value
        NotAHole ->
          case tl.data of
            TLHandler h ->
              if TL.isExpression h id
              then
                replaceExpr m h tlid id value
              else
                let replacement = TL.replaceSpecHole id value h.spec in
                wrap <| SetHandler tlid tl.pos { h | spec = replacement }
            _ -> NoChange

  -- let pt = EntryParser.parseFully value
  -- in case pt of
  --   Ok pt -> execute m <| EntryParser.pt2ast m cursor pt
  --   Err error -> Error <| EntryParser.toErrorMessage <| EntryParser.addCursorToError error cursor
