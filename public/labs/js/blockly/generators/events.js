// javascript.javascriptGenerator.forBlock["when_run_clicked"] = function (
//   block,
//   generator,
// ) {
//   const nextBlock = block.getNextBlock();

//   if (!nextBlock) return "";

//   return generator.blockToCode(nextBlock);
// };


javascript.javascriptGenerator.forBlock["when_run_clicked"] = function (
  block,
  generator,
) {
  const statements = generator.statementToCode(block, "DO");

  return statements;
};