var collector = {};
module.exports = collector;
/*
    get data and return it to server

    prms - object with collector parameters {
        <parameter1>: <value>,
        <parameter2>: <value>,
        ....
        $id: <objectCounterID>,
        $variables: {
            <variable1>: <variableValue1>,
            <variable2>: <variableValue2>,
            ...
        }
    }

    where
    $id - objectCounter ID
    $variables - variables for collector from counter settings

    callback(err, result)
    result - object {timestamp: <timestamp>, value: <value>} or simple value
*/

collector.get = function(prms, callback) {

    /* insert collector code here */

    callback(null, prms.constant);
};

