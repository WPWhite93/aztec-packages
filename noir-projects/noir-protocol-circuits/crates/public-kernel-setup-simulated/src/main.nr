use dep::public_kernel_lib::PublicKernelSetupCircuitPrivateInputs;
use dep::types::PublicKernelCircuitPublicInputs;

unconstrained fn main(input: PublicKernelSetupCircuitPrivateInputs) ->  pub PublicKernelCircuitPublicInputs {
    input.public_kernel_setup()
}
