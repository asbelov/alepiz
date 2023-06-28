/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


// The functions will be passed from the parent frame
// describe the function here to prevent the error message
if(!setActionConfig) setActionConfig = function () {}
if(!getActionConfig) getActionConfig = function (callback) {callback();}

function initResizer() {
    getActionConfig(function (config) {
        var actionConfig = config || {};
        if(actionConfig.taskListHeightPercent > 90) actionConfig.taskListHeightPercent = 90;
        else if(actionConfig.taskListHeightPercent < 10) actionConfig.taskListHeightPercent = 10;

        // Query the element
        const resizerJSElm = document.getElementById('resizer');
        const parentJSElm = resizerJSElm.parentNode;
        const topJSElm = resizerJSElm.previousElementSibling;
        const bottomJSElm = resizerJSElm.nextElementSibling;
        let topElmHeight = 0;
        let bottomElmHeight = 0
        let topElmWidth = 0;
        const direction = resizerJSElm.getAttribute('data-direction') || 'horizontal';

        let bodyHeight = window.innerHeight - topJSElm.getBoundingClientRect().top;
        parentJSElm.style.height = `${bodyHeight}px`;
        //console.log(actionConfig.taskListHeightPercent)
        topElmHeight = Math.round(bodyHeight * (actionConfig.taskListHeightPercent || 50) / 100);
        topJSElm.style.height = `${topElmHeight}px`;
        let bottomElmHeightPercent = topJSElm.getBoundingClientRect().height / bodyHeight;

        bottomElmHeight =
            (bodyHeight - topElmHeight - resizerJSElm.getBoundingClientRect().height - 50) * 100 /
            bodyHeight;
        bottomJSElm.style.height = `${bottomElmHeight}%`;

        resizerJSElm.style.cursor = direction === 'horizontal' ? 'em-resize' : 'ns-resize';

        // The current position of mouse
        let x = 0;
        let y = 0;

        const resizeHandler = function () {
            clearTimeout(window.resizedFinished);
            window.resizedFinished = setTimeout(function () {
                bodyHeight = window.innerHeight - topJSElm.getBoundingClientRect().top;
                parentJSElm.style.height = `${bodyHeight}px`;
                topElmHeight = Math.round(bodyHeight * bottomElmHeightPercent)
                topJSElm.style.height = `${topElmHeight}px`;

                bottomElmHeight =
                    (bodyHeight - topElmHeight - resizerJSElm.getBoundingClientRect().height - 50) * 100 /
                    bodyHeight;
                bottomJSElm.style.height = `${bottomElmHeight}%`;

                actionConfig.taskListHeightPercent = 100 - bottomElmHeight;
                if(actionConfig.taskListHeightPercent > 90) actionConfig.taskListHeightPercent = 90;
                else if(actionConfig.taskListHeightPercent < 10) actionConfig.taskListHeightPercent = 10;
                //console.log(actionConfig.taskListHeightPercent)
                setActionConfig(actionConfig);
            }, 250);
        }

        const mouseDownHandler = function (e) {
            x = e.clientX;
            y = e.clientY;

            topElmHeight = topJSElm.getBoundingClientRect().height;
            bottomElmHeight = bottomJSElm.getBoundingClientRect().height;
            topElmWidth = topJSElm.getBoundingClientRect().width;

            document.body.style.cursor = direction === 'horizontal' ? 'em-resize' : 'ns-resize';

            // Attach the listeners to `document`
            document.addEventListener('mousemove', mouseMoveHandler);
            document.addEventListener('mouseup', mouseUpHandler);
        };

        const mouseMoveHandler = function (e) {
            // How far the mouse has been moved
            const dx = e.clientX - x;
            const dy = e.clientY - y;

            switch (direction) {
                case 'vertical':
                    const h = (topElmHeight + dy) * 100 / parentJSElm.getBoundingClientRect().height;
                    // Actions height  = parentJSElm.getBoundingClientRect().height - (topElmHeight + dy)
                    //if (h > 10 && h < 90) {
                        topJSElm.style.height = `${h}%`;
                        const h1 = (bottomElmHeight - dy) * 100 / parentJSElm.getBoundingClientRect().height;
                        bottomJSElm.style.height = `${h1}%`;
                    //}
                    bottomElmHeightPercent = topJSElm.getBoundingClientRect().height / bodyHeight;
                    break;
                case 'horizontal':
                default:
                    const w = (topElmWidth + dx) * 100 / parentJSElm.getBoundingClientRect().width;
                    if (w > 10 && w < 90) topJSElm.style.width = `${w}%`;
                    break;
            }

            topJSElm.style.userSelect = 'none';
            topJSElm.style.pointerEvents = 'none';

            bottomJSElm.style.userSelect = 'none';
            bottomJSElm.style.pointerEvents = 'none';
        };

        const mouseUpHandler = function () {
            document.body.style.removeProperty('cursor');

            topJSElm.style.removeProperty('user-select');
            topJSElm.style.removeProperty('pointer-events');

            bottomJSElm.style.removeProperty('user-select');
            bottomJSElm.style.removeProperty('pointer-events');

            // Remove the handlers of `mousemove` and `mouseup`
            document.removeEventListener('mousemove', mouseMoveHandler);
            document.removeEventListener('mouseup', mouseUpHandler);

            actionConfig.taskListHeightPercent =
                topJSElm.getBoundingClientRect().height * 100 / parentJSElm.getBoundingClientRect().height
            //console.log(actionConfig.taskListHeightPercent)
            setActionConfig(actionConfig);
        };

// Attach the event handlers
        resizerJSElm.addEventListener('mousedown', mouseDownHandler);
        window.addEventListener('resize', resizeHandler);
    });
}