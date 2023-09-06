@echo off
set CNT=100
set SLEEP=2
set PROG=%0
REM COMMAND LINE ARGUMENT PARSING
:loop
IF NOT "%1"=="" (
    IF "%1"=="-sleep" (
        SET /A SLEEP=%2+1
        SHIFT
    )
    IF "%1"=="-cnt" (
        SET CNT=%2
        SHIFT
    )
    SHIFT
    GOTO :loop
)

REM LOOP
FOR /L %%I IN (1,1,%CNT%) DO (
echo Iteration number %%I
REM THERE IS A SLEEP
ping -n %SLEEP% 127.0.0.1 > nul
)

echo print %PROG%
type %PROG%

