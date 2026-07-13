FROM public.ecr.aws/lambda/python:3.10

COPY requirements.txt ${LAMBDA_TASK_ROOT}

# FIX: Force pip to use a stable temp directory and pass the extra index safely
RUN TMPDIR=/tmp pip install \
    --no-cache-dir \
    -r requirements.txt \
    --target "${LAMBDA_TASK_ROOT}" \
    --extra-index-url https://download.pytorch.org/whl/cpu

# Copy application layers
COPY run_server.py ${LAMBDA_TASK_ROOT}
COPY train_gnn.py ${LAMBDA_TASK_ROOT}
COPY models/ ${LAMBDA_TASK_ROOT}/models/

CMD [ "run_server.lambda_handler" ]