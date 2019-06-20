load('benchmark.js');
load('tests/modules/sliced_strings.setup.js')

var arrayNumbers = new BenchmarkSuite('SlicedStrings Memory Overhead', 100, [
    new Benchmark("Clear with slice(1)", () => {
        Test(test_arr, (str) => {
            //Но остаётся ссылка на строку ' ' + str
            //То есть в итоге строка занимает чуть больше
            return (' ' + str).slice(1);
      })
    })
]);

BenchmarkSuite.RunSuites({ NotifyResult: PrintResult,
    NotifyError: PrintError,
    NotifyScore: PrintScore });