-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "swapBackTools" TEXT[] DEFAULT ARRAY['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep']::TEXT[];
