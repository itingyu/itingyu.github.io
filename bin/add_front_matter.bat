echo off
CHCP 65001
set p0=%0
set p1=%1
set p2=%2
set p3=%3
echo ######################
echo src    dir     :%p1%
echo dest  dir     :%p2%
echo copy other files :%p3%
echo ########start###########

java App %p1%  %p2% %p3%

echo ########End###########