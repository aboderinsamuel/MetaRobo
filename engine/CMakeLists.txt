cmake_minimum_required(VERSION 3.16)
project(plantsim CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(plantsim STATIC src/plantsim.cpp src/api.cpp)
target_compile_options(plantsim PRIVATE $<$<NOT:$<CXX_COMPILER_ID:MSVC>>:-Wall -Wextra>)

add_executable(test_engine tests/test_engine.cpp)
target_link_libraries(test_engine plantsim)

enable_testing()
# Runs from the engine folder so tests/golden.json lands next to the sources.
add_test(NAME plantsim_validation COMMAND test_engine WORKING_DIRECTORY ${CMAKE_SOURCE_DIR})
