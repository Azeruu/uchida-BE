/*
  Warnings:

  - Added the required column `participant_no_hp` to the `test_results` table without a default value. This is not possible if the table is not empty.
  - Added the required column `participant_pendidikan` to the `test_results` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "test_results" ADD COLUMN     "participant_no_hp" TEXT NOT NULL,
ADD COLUMN     "participant_pendidikan" TEXT NOT NULL;
