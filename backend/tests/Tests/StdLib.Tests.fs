module Tests.StdLib

// Misc tests of Stdlib (both LibCloud and LibExecution) that could not be
// tested via LibExecution.tests

open Expecto

open System.Threading.Tasks
open FSharp.Control.Tasks

open Prelude
open Prelude.Tablecloth
open Tablecloth

module RT = LibExecution.RuntimeTypes
module PT = LibExecution.ProgramTypes
module PT2RT = LibExecution.ProgramTypesToRuntimeTypes
module PTParser = LibExecution.ProgramTypesParser
module Exe = LibExecution.Execution

open TestUtils.TestUtils

let oldFunctionsAreDeprecated =
  testTask "old functions are deprecated" {
    let counts = ref Map.empty

    let fns = builtIns.fns |> Map.values

    fns
    |> List.iter (fun fn ->
      let key = RT.FnName.builtinToString { fn.name with version = 0 }

      if fn.deprecated = RT.NotDeprecated then
        counts.Value <-
          Map.update
            key
            (fun count -> count |> Option.defaultValue 0 |> (+) 1 |> Some)
            counts.Value

      ())

    Map.iter
      (fun name count ->
        Expect.equal count 1 $"{name} has more than one undeprecated function")
      counts.Value
  }

let oldTypesAreDeprecated =
  testTask "old types are deprecated" {
    let counts = ref Map.empty

    let types = builtIns.types |> Map.values

    types
    |> List.iter (fun typ ->
      let key = RT.TypeName.builtinToString { typ.name with version = 0 }

      if typ.deprecated = RT.NotDeprecated then
        counts.Value <-
          Map.update
            key
            (fun count -> count |> Option.defaultValue 0 |> (+) 1 |> Some)
            counts.Value

      ())

    Map.iter
      (fun name count ->
        Expect.equal count 1 $"{name} has more than one undeprecated type")
      counts.Value
  }

let tests = testList "stdlib" [ oldFunctionsAreDeprecated; oldTypesAreDeprecated ]
